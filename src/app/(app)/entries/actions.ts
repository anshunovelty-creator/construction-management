'use server';

import { revalidatePath } from 'next/cache';
import { redirect, RedirectType } from 'next/navigation';
import type { FormState } from '@/components/form';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { accountScope, firmErrors } from '@/lib/firm';
import { cashCloseDifference, ownerCapital, ownerDrawing, siteCashExpense } from '@/lib/ledger/posting/cash';
import { clientBill, clientReceipt } from '@/lib/ledger/posting/client';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import { billTotals, type PricedItem } from '@/lib/ledger/bill-items';
import type { CostHead, EntryDraft, MoneyAccountRef } from '@/lib/ledger/types';
import { showPaise, percentOf } from '@/lib/money';
import { parseFields, submittedValues, type Value } from '@/lib/masters/parse';
import { getEntryForm, type EntryFormSlug, type Field } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;

async function moneyAccount(db: Db, id: string): Promise<MoneyAccountRef> {
  const { data } = await db.from('money_accounts').select('id, kind, firm_id').eq('id', id).maybeSingle();
  if (!data) throw new Error('bank or cash account not found');
  return { id: data.id, kind: data.kind, firmId: data.firm_id };
}

/** A bill's TDS rate for the TDS record: the rate in basis points, and the section it comes from (Setup → TDS rates). */
async function tdsFor(db: Db, rateBp: number): Promise<{ rateBp: number; section: string }> {
  const { data } = await db.from('tds_rates').select('section').eq('rate_bp', rateBp).maybeSingle();
  return { rateBp, section: (data?.section as string | undefined) ?? '' };
}

/**
 * How a payment or receipt was made, when given, must match its account: cash goes through a cash account, online and
 * cheque through a bank. Left out (the Pay card, the sheets), the account alone says how.
 * Throws a marker that saveEntry turns into a message under the method box.
 */
function checkMethod(method: string, account: MoneyAccountRef): void {
  if (method && (method === 'cash') !== (account.kind !== 'bank')) throw new Error('payment_method');
}

/** What the books say is in a bank or cash account right now. */
async function moneyBalance(db: Db, accountId: string): Promise<number> {
  const { data } = await db.from('balances').select('amount_paise').eq('account', 'money').eq('money_account_id', accountId);
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount_paise), 0);
}

/** The optional material and the type; picking a material is enough, the type then defaults to material. */
function materialAndType(s: (name: string) => string): { materialId?: string; costHead: CostHead } {
  const materialId = s('material_id') || undefined;
  const costHead = (s('cost_head') || (materialId ? 'material' : '')) as CostHead;
  if (!costHead) throw new Error('choose a type, or a material');
  return { materialId, costHead };
}

/**
 * For each bank/cash field filled in, the firm of the row picked (null = common cash).
 * Rows the person may not see are left out; buildDraft then reports them as not found.
 */
async function firmsPicked(fields: Field[], v: Record<string, Value>, db: Db): Promise<Record<string, string | null>> {
  const picked: Record<string, string | null> = {};
  for (const field of fields) {
    const id = v[field.name];
    if (field.kind !== 'ref' || typeof id !== 'string') continue;
    if (!accountScope(field.ref)) continue;
    const { data } = await db.from('money_accounts').select('firm_id').eq('id', id).maybeSingle();
    if (data) picked[field.name] = data.firm_id as string | null;
  }
  return picked;
}

/** Turns a submitted form into a balanced ledger entry, using the tested posting rules. `firmId` is the form's firm. */
async function buildDraft(slug: EntryFormSlug, v: Record<string, Value>, firmId: string | null, db: Db): Promise<EntryDraft> {
  const s = (name: string) => v[name] as string;
  const n = (name: string) => v[name] as number;

  switch (slug) {
    case 'vendor-bill': {
      const billItems = v.items as PricedItem[];
      const { base, gst } = billTotals(billItems);
      // Left empty, no TDS is deducted.
      const rate = v.tds_rate as string | null;
      return vendorBill({
        firmId: firmId!, vendorId: s('vendor_id'), siteId: s('site_id'), billDate: s('entry_date'), billNo: s('bill_no'),
        items: [{ costHead: (s('cost_head') || 'material') as CostHead, amountPaise: base }], gstPaise: gst, billItems,
        tds: rate === null ? undefined : await tdsFor(db, Number(rate)),
        narration: s('narration'),
      });
    }
    case 'pay-vendor': {
      const from = await moneyAccount(db, s('from_account_id'));
      checkMethod(s('payment_method'), from);
      return vendorPayment({
        billFirmId: firmId!, vendorId: s('vendor_id'), from,
        amountPaise: n('amount'), paymentDate: s('entry_date'), reference: s('reference'), narration: s('narration'),
      });
    }
    case 'client-bill': {
      const billItems = v.items as PricedItem[];
      const { base: gross, gst } = billTotals(billItems);
      // Left empty, no TDS, retention or deposit is cut. TDS is worked out on the bill before GST.
      const tds = v.tds_rate === null ? undefined : await tdsFor(db, Number(v.tds_rate));
      const cut = (name: string) => (v[name] === null ? undefined : n(name));
      return clientBill({
        client: { firmId: firmId!, clientId: s('client_id'), siteId: s('site_id') },
        billDate: s('entry_date'), billNo: s('bill_no'), grossPaise: gross, gstPaise: gst, billItems,
        narration: s('narration'),
        deductions: {
          tdsPaise: tds && percentOf(gross, tds.rateBp),
          retentionPaise: cut('retention'),
          securityDepositPaise: cut('security_deposit'),
        },
        tds,
      });
    }
    case 'client-receipt': {
      const to = await moneyAccount(db, s('to_account_id'));
      checkMethod(s('payment_method'), to);
      return clientReceipt({
        client: { firmId: firmId!, clientId: s('client_id') }, to,
        amountPaise: n('amount'), receiptDate: s('entry_date'), reference: s('reference'), narration: s('narration'),
      });
    }
    case 'site-spend': {
      const { materialId, costHead } = materialAndType(s);
      return siteCashExpense({
        from: await moneyAccount(db, s('from_account_id')), siteId: s('site_id'), costHead,
        amountPaise: n('amount'), expenseDate: s('entry_date'), paidToPartyId: s('paid_to_id') || undefined,
        narration: s('narration'), materialId,
      });
    }
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

/**
 * A bill number already in this firm's books for the same vendor or client is almost always the same bill typed twice.
 * Returns that entry's serial; cancelled bills don't count, and neither does this same entry (a retried sheet row).
 */
async function sameBillNumber(db: Db, draft: EntryDraft): Promise<string | null> {
  if ((draft.entryType !== 'vendor_bill' && draft.entryType !== 'client_bill') || !draft.reference || !draft.partyId) return null;
  const { data: same } = await db.from('entries').select('id, serial')
    .eq('entry_type', draft.entryType).eq('party_id', draft.partyId).eq('reference', draft.reference)
    .eq('firm_id', draft.firmId!).neq('id', draft.id);
  if (!same?.length) return null;
  const { data: statuses } = await db.from('entry_status').select('entry_id, status').in('entry_id', same.map((e) => e.id));
  const cancelled = new Set((statuses ?? []).filter((s) => s.status === 'cancelled').map((s) => s.entry_id));
  return same.find((e) => !cancelled.has(e.id))?.serial ?? null;
}

export type Saved = { id: string; serial: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Saves one entry as the signed-in user. The database checks permissions, balance and locks again.
 * `firmId` is the firm the form was opened in (null for supervisors): the entry is made for that firm,
 * even if the person has switched firm since. `entryId` makes a retry safe: saving the same id twice
 * returns the first entry instead of a copy.
 */
async function saveEntry(slug: string, firmId: string | null, data: FormData, db: Db, entryId?: string): Promise<Saved | FormState> {
  const form = getEntryForm(slug);
  const profile = await requireProfile();
  if (!form || !(form.roles as string[]).includes(profile.role)) return { errors: { _form: 'not_allowed' } };

  const values = submittedValues(data);
  const parsed = parseFields(form.fields, data);
  if (!parsed.ok) return { errors: parsed.errors, values };
  const working = await getWorkingFirm();
  const picked = working ? await firmsPicked(form.fields, parsed.values, db) : {};
  const wrong = firmErrors(slug, form.fields, firmId, working ? working.firms.map((f) => f.id) : null, picked);
  if (wrong) return { errors: wrong, values };

  if (slug === 'day-close') {
    // ponytail: compares with today's balance, not the balance on the chosen date.
    const expected = await moneyBalance(db, parsed.values.account_id as string);
    if (expected === parsed.values.counted) return { errors: { _form: 'cash_matches' }, detail: showPaise(expected), values };
  }
  let draft: EntryDraft;
  try {
    draft = await buildDraft(slug as EntryFormSlug, parsed.values, firmId, db);
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'payment_method') return { errors: { payment_method: 'method_account' }, values };
    return { errors: { _form: 'save_failed' }, detail: message, values };
  }
  if (entryId && UUID.test(entryId)) draft.id = entryId;
  const repeat = await sameBillNumber(db, draft);
  if (repeat) return { errors: { _form: 'duplicate_bill', bill_no: 'duplicate' }, detail: repeat, values };
  const { data: result, error } = await db.rpc('app_post_entry', { p_entry: draft });
  if (error) return { errors: { _form: 'save_failed' }, detail: error.message, values };
  return result as Saved;
}

/** Saves one money form, then opens the new entry. `firmId`: the firm the form was opened in. */
export async function postEntryForm(slug: string, firmId: string | null, _state: FormState, data: FormData): Promise<FormState> {
  const saved = await saveEntry(slug, firmId, data, await createClient());
  if (!('id' in saved)) return saved;
  revalidatePath('/', 'layout');
  redirect(`/entries/${saved.id}?saved=1`);
}

/** Saves sheet rows one by one, each through the same checks as the form. Result per row id. */
export async function postEntryRows(
  slug: string,
  firmId: string | null,
  rows: { id: string; cells: Record<string, string> }[],
): Promise<Record<string, Saved | FormState>> {
  const db = await createClient();
  const results: Record<string, Saved | FormState> = {};
  for (const row of rows) {
    const data = new FormData();
    for (const [name, value] of Object.entries(row.cells)) data.set(name, value);
    results[row.id] = await saveEntry(slug, firmId, data, db, row.id);
  }
  revalidatePath('/', 'layout');
  return results;
}

/** One bill or payment from the quick card on a party's page. Stays on the page, which then shows the new totals. */
export async function postPartyEntry(
  slug: 'vendor-bill' | 'pay-vendor',
  firmId: string,
  vendorId: string,
  _state: FormState,
  data: FormData,
): Promise<FormState> {
  data.set('vendor_id', vendorId);
  const saved = await saveEntry(slug, firmId, data, await createClient());
  if (!('id' in saved)) return saved;
  revalidatePath('/', 'layout');
  return { saved: saved.serial };
}

/** A bill from the client page. Stays on the page, which then shows the new totals. */
export async function postClientBill(firmId: string, clientId: string, _state: FormState, data: FormData): Promise<FormState> {
  data.set('client_id', clientId);
  const saved = await saveEntry('client-bill', firmId, data, await createClient());
  if (!('id' in saved)) return saved;
  revalidatePath('/', 'layout');
  return { saved: saved.serial };
}

/** Sheet rows on a party's page: every row is for the same firm and vendor. */
export async function postPartyRows(
  slug: 'vendor-bill' | 'pay-vendor',
  firmId: string,
  vendorId: string,
  rows: { id: string; cells: Record<string, string> }[],
): Promise<Record<string, Saved | FormState>> {
  return postEntryRows(slug, firmId, rows.map((row) => ({ ...row, cells: { ...row.cells, vendor_id: vendorId } })));
}

/** Receipt rows on a client's page: every row is for the same firm and client. */
export async function postClientRows(
  firmId: string,
  clientId: string,
  rows: { id: string; cells: Record<string, string> }[],
): Promise<Record<string, Saved | FormState>> {
  return postEntryRows('client-receipt', firmId, rows.map((row) => ({ ...row, cells: { ...row.cells, client_id: clientId } })));
}

// Replace, not push: after a cancel the browser's back (and the page's Back link) still returns to where the entry was opened from.
const backTo = (id: string, error?: { message: string } | null) =>
  redirect(`/entries/${id}${error ? `?error=${encodeURIComponent(error.message)}` : ''}`, RedirectType.replace);

/** Cancels an entry: posts its exact opposite, recording who, when and why. Errors come back to the entry page. */
export async function cancelEntry(id: string, data: FormData): Promise<void> {
  await requireProfile();
  const reason = String(data.get('reason') ?? '').trim();
  if (reason === '') backTo(id, { message: 'reason_required' });
  const db = await createClient();
  const { error } = await db.rpc('app_reverse_entry', { p_entry_id: id, p_reason: reason });
  revalidatePath('/', 'layout');
  backTo(id, error);
}
