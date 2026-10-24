'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { cashCloseDifference, cashTransfer, ownerCapital, ownerDrawing, siteCashExpense } from '@/lib/ledger/posting/cash';
import { clientBill, clientReceipt } from '@/lib/ledger/posting/client';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import type { CostHead, EntryDraft, MoneyAccountRef, WorkOrderRef } from '@/lib/ledger/types';
import { showPaise, percentOf } from '@/lib/money';
import { parseFields, submittedValues, type Value } from '@/lib/masters/parse';
import { getEntryForm, type EntryFormSlug } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;

async function moneyAccount(db: Db, id: string): Promise<MoneyAccountRef> {
  const { data } = await db.from('money_accounts').select('id, kind, firm_id').eq('id', id).maybeSingle();
  if (!data) throw new Error('bank or cash account not found');
  return { id: data.id, kind: data.kind, firmId: data.firm_id };
}

async function workOrder(db: Db, id: string) {
  const { data } = await db
    .from('work_orders')
    .select('id, firm_id, client_id, site_id, tds_bp, retention_bp, security_deposit_bp')
    .eq('id', id)
    .maybeSingle();
  if (!data) throw new Error('work order not found');
  const ref: WorkOrderRef = { id: data.id, firmId: data.firm_id, clientId: data.client_id, siteId: data.site_id };
  return { ref, tdsBp: data.tds_bp as number, retentionBp: data.retention_bp as number, depositBp: data.security_deposit_bp as number };
}

/** What the books say is in a bank or cash account right now. */
async function moneyBalance(db: Db, accountId: string): Promise<number> {
  const { data } = await db.from('balances').select('amount_paise').eq('account', 'money').eq('money_account_id', accountId);
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount_paise), 0);
}

/** Turns a submitted form into a balanced ledger entry, using the tested posting rules. */
async function buildDraft(slug: EntryFormSlug, v: Record<string, Value>, db: Db): Promise<EntryDraft> {
  const s = (name: string) => v[name] as string;
  const n = (name: string) => v[name] as number;

  switch (slug) {
    case 'vendor-bill': {
      const materialId = s('material_id') || undefined;
      const costHead = (s('cost_head') || (materialId ? 'material' : '')) as CostHead;
      if (!costHead) throw new Error('choose a type, or a material');
      return vendorBill({
        firmId: s('firm_id'), vendorId: s('vendor_id'), siteId: s('site_id'), billDate: s('entry_date'), billNo: s('bill_no'),
        items: [{ costHead, amountPaise: n('amount') }], narration: s('narration'), materialId,
      });
    }
    case 'pay-vendor':
      return vendorPayment({
        billFirmId: s('firm_id'), vendorId: s('vendor_id'), from: await moneyAccount(db, s('from_account_id')),
        amountPaise: n('amount'), paymentDate: s('entry_date'), reference: s('reference'), narration: s('narration'),
      });
    case 'client-bill': {
      const wo = await workOrder(db, s('work_order_id'));
      const gross = n('gross');
      // An empty deduction box means "use the work order's percentage".
      const pick = (name: string, bp: number) => (v[name] === null ? percentOf(gross, bp) : n(name));
      return clientBill({
        workOrder: wo.ref, billDate: s('entry_date'), billNo: s('bill_no'), grossPaise: gross, narration: s('narration'),
        deductions: {
          tdsPaise: pick('tds', wo.tdsBp),
          retentionPaise: pick('retention', wo.retentionBp),
          securityDepositPaise: pick('security_deposit', wo.depositBp),
        },
      });
    }
    case 'client-receipt':
      return clientReceipt({
        workOrder: (await workOrder(db, s('work_order_id'))).ref, to: await moneyAccount(db, s('to_account_id')),
        amountPaise: n('amount'), receiptDate: s('entry_date'), reference: s('reference'), narration: s('narration'),
      });
    case 'move-money':
      return cashTransfer({
        from: await moneyAccount(db, s('from_account_id')), to: await moneyAccount(db, s('to_account_id')),
        amountPaise: n('amount'), transferDate: s('entry_date'), reference: s('reference'), narration: s('narration'),
      });
    case 'site-spend':
      return siteCashExpense({
        from: await moneyAccount(db, s('from_account_id')), siteId: s('site_id'), costHead: s('cost_head') as CostHead,
        amountPaise: n('amount'), expenseDate: s('entry_date'), paidToPartyId: s('paid_to_id') || undefined,
        narration: s('narration'),
      });
    case 'day-close': {
      const account = await moneyAccount(db, s('account_id'));
      return cashCloseDifference({
        account, expectedPaise: await moneyBalance(db, account.id), countedPaise: n('counted'), closeDate: s('entry_date'),
      });
    }
    case 'owner-money': {
      const input = { account: await moneyAccount(db, s('account_id')), amountPaise: n('amount'), date: s('entry_date'), narration: s('narration') };
      return s('direction') === 'in' ? ownerCapital(input) : ownerDrawing(input);
    }
  }
}

export type Saved = { id: string; serial: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Saves one entry as the signed-in user. The database checks permissions, balance and locks again.
 * `entryId` makes a retry safe: saving the same id twice returns the first entry instead of a copy.
 */
async function saveEntry(slug: string, data: FormData, db: Db, entryId?: string): Promise<Saved | FormState> {
  const form = getEntryForm(slug);
  const profile = await requireProfile();
  if (!form || !(form.roles as string[]).includes(profile.role)) return { errors: { _form: 'not_allowed' } };

  const values = submittedValues(data);
  const parsed = parseFields(form.fields, data);
  if (!parsed.ok) return { errors: parsed.errors, values };

  if (slug === 'day-close') {
    // ponytail: compares with today's balance, not the balance on the chosen date.
    const expected = await moneyBalance(db, parsed.values.account_id as string);
    if (expected === parsed.values.counted) return { errors: { _form: 'cash_matches' }, detail: showPaise(expected), values };
  }
  let draft: EntryDraft;
  try {
    draft = await buildDraft(slug as EntryFormSlug, parsed.values, db);
  } catch (error) {
    return { errors: { _form: 'save_failed' }, detail: (error as Error).message, values };
  }
  if (entryId && UUID.test(entryId)) draft.id = entryId;
  const { data: result, error } = await db.rpc('app_post_entry', { p_entry: draft });
  if (error) return { errors: { _form: 'save_failed' }, detail: error.message, values };
  return result as Saved;
}

/** Saves one money form, then opens the new entry. */
export async function postEntryForm(slug: string, _state: FormState, data: FormData): Promise<FormState> {
  const saved = await saveEntry(slug, data, await createClient());
  if (!('id' in saved)) return saved;
  revalidatePath('/', 'layout');
  redirect(`/entries/${saved.id}?saved=1`);
}

/** Saves sheet rows one by one, each through the same checks as the form. Result per row id. */
export async function postEntryRows(
  slug: string,
  rows: { id: string; cells: Record<string, string> }[],
): Promise<Record<string, Saved | FormState>> {
  const db = await createClient();
  const results: Record<string, Saved | FormState> = {};
  for (const row of rows) {
    const data = new FormData();
    for (const [name, value] of Object.entries(row.cells)) data.set(name, value);
    results[row.id] = await saveEntry(slug, data, db, row.id);
  }
  revalidatePath('/', 'layout');
  return results;
}

/** Sheet rows on a party's page: every row gets the same firm and vendor. */
export async function postPartyRows(
  slug: 'vendor-bill' | 'pay-vendor',
  fixed: { firm_id: string; vendor_id: string },
  rows: { id: string; cells: Record<string, string> }[],
): Promise<Record<string, Saved | FormState>> {
  return postEntryRows(slug, rows.map((row) => ({ ...row, cells: { ...row.cells, ...fixed } })));
}

const backTo = (id: string, error?: { message: string } | null) =>
  redirect(`/entries/${id}${error ? `?error=${encodeURIComponent(error.message)}` : ''}`);

/** Marks someone else's entry as checked. Errors come back to the entry page in the address. */
export async function verifyEntry(id: string): Promise<void> {
  await requireProfile('owner', 'office');
  const db = await createClient();
  const { error } = await db.rpc('app_verify_entry', { p_entry_id: id });
  revalidatePath('/', 'layout');
  backTo(id, error);
}

/** Rejects (someone else's unchecked entry) or cancels an entry. Both post an exact opposite entry. */
export async function cancelEntry(id: string, data: FormData): Promise<void> {
  await requireProfile();
  const reason = String(data.get('reason') ?? '').trim();
  if (reason === '') backTo(id, { message: 'reason_required' });
  const db = await createClient();
  const { error } = data.get('do') === 'reject'
    ? await db.rpc('app_reject_entry', { p_entry_id: id, p_reason: reason })
    : await db.rpc('app_reverse_entry', { p_entry_id: id, p_reason: reason });
  revalidatePath('/', 'layout');
  backTo(id, error);
}
