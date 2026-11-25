'use server';

import { partyLine, roundOffAmount, roundOffDraft } from '@/lib/ledger/round-off';
import { revalidatePath } from 'next/cache';
import { redirect, RedirectType } from 'next/navigation';
import type { FormState } from '@/components/form';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { firmErrors, firmsForSave } from '@/lib/firm';
import { cashTransfer, notYetKnown, ownerCapital, ownerDrawing, siteCashExpense } from '@/lib/ledger/posting/cash';
import { otherMoney, reasonOf } from '@/lib/ledger/posting/other';
import { clientBill, clientReceipt } from '@/lib/ledger/posting/client';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import type { CostHead, EntryDraft, MoneyAccountRef } from '@/lib/ledger/types';
import { showPaise, percentOf } from '@/lib/money';
import { parseFields, submittedValues, type Value } from '@/lib/masters/parse';
import { getEntryForm, type EntryFormSlug, type Field } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from './data';

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

/** The optional material and the type; picking a material is enough, the type then defaults to material. */
function materialAndType(s: (name: string) => string): { materialId?: string; costHead: CostHead } {
  const materialId = s('material_id') || undefined;
  const costHead = (s('cost_head') || (materialId ? 'material' : '')) as CostHead;
  if (!costHead) throw new Error('choose a type, or a material');
  return { materialId, costHead };
}

/**
 * For each bank/cash field filled in, the firm of the row picked (null = shared cash from before each firm had its own).
 * Rows the person may not see are left out; buildDraft then reports them as not found.
 */
async function firmsPicked(fields: Field[], v: Record<string, Value>, db: Db): Promise<Record<string, string | null>> {
  const picked: Record<string, string | null> = {};
  for (const field of fields) {
    const id = v[field.name];
    if (field.kind !== 'ref' || field.ref !== 'moneyAccounts' || typeof id !== 'string') continue;
    const { data } = await db.from('money_accounts').select('firm_id').eq('id', id).maybeSingle();
    if (data) picked[field.name] = data.firm_id as string | null;
  }
  return picked;
}

/** A bill's GST: its one rate (basis points) on the amount before GST; none when no rate was picked. */
const gstOf = (v: Record<string, Value>) => (v.gst_rate === null ? 0 : percentOf(v.amount as number, Number(v.gst_rate)));

/** Turns a submitted form into a balanced ledger entry, using the tested posting rules. `firmId` is the form's firm. */
async function buildDraft(slug: EntryFormSlug, v: Record<string, Value>, firmId: string | null, db: Db): Promise<EntryDraft> {
  const s = (name: string) => v[name] as string;
  const n = (name: string) => v[name] as number;

  switch (slug) {
    case 'vendor-bill': {
      // Left empty, no TDS is deducted.
      const rate = v.tds_rate as string | null;
      return vendorBill({
        firmId: firmId!, vendorId: s('vendor_id'), siteId: s('site_id'), billDate: s('entry_date'), billNo: s('bill_no'),
        // The owner keeps the money only (owner decision 2026-11-03), so a bill is not split by type: it counts as material.
        items: [{ costHead: 'material', amountPaise: n('amount') }],
        gstPaise: gstOf(v),
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
      const gross = n('amount');
      // Left empty, no TDS, retention or deposit is cut. TDS is worked out on the bill before GST.
      const tds = v.tds_rate === null ? undefined : await tdsFor(db, Number(v.tds_rate));
      const cut = (name: string) => (v[name] === null ? undefined : n(name));
      return clientBill({
        client: { firmId: firmId!, clientId: s('client_id'), siteId: s('site_id') },
        billDate: s('entry_date'), billNo: s('bill_no'), grossPaise: gross, gstPaise: gstOf(v),
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
    case 'move-money':
      return cashTransfer({
        from: await moneyAccount(db, s('from_account_id')), to: await moneyAccount(db, s('to_account_id')),
        amountPaise: n('amount'), transferDate: s('entry_date'), reference: s('reference'), narration: s('narration'),
      });
    case 'not-yet-known':
      return notYetKnown({
        account: await moneyAccount(db, s('account_id')), direction: s('direction') as 'in' | 'out',
        amountPaise: n('amount'), date: s('entry_date'), reference: s('reference'), narration: s('narration'),
      });
    case 'other-money':
      return otherMoney({
        reason: s('reason'), account: await moneyAccount(db, s('account_id')), amountPaise: n('amount'), date: s('entry_date'),
        partyId: s('person_id') || undefined, month: s('month'), reference: s('reference'), narration: s('narration'),
      });
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

/**
 * A payment or receipt that looks like one already there: the same account, day, amount and person, or the same cheque or
 * UTR number with the same person. Returns that entry's serial. Asked for by the pop-ups, which offer Save anyway; rows
 * typed in a sheet are in front of the person already.
 */
async function looksRepeated(db: Db, draft: EntryDraft, replaced?: string): Promise<string | null> {
  const line = draft.lines.find((l) => l.account === 'money');
  if (!line?.moneyAccountId) return null;
  const alike = () => {
    let query = db.from('money_rows').select('entry_id, serial').eq('money_account_id', line.moneyAccountId!).eq('entry_type', draft.entryType)
      .neq('entry_id', draft.id).limit(1);
    query = draft.partyId ? query.eq('party_id', draft.partyId) : query.is('party_id', null);
    return replaced ? query.neq('entry_id', replaced) : query;
  };
  const [{ data: same }, { data: number }] = await Promise.all([
    alike().eq('entry_date', draft.entryDate).eq('amount_paise', line.amountPaise),
    // A tax entry's reference is its month, so only people are looked at.
    draft.partyId && draft.reference ? alike().eq('reference', draft.reference) : { data: [] as { serial: string }[] },
  ]);
  return same?.[0]?.serial ?? number?.[0]?.serial ?? null;
}

export type Saved = { id: string; serial: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Saves one entry as the signed-in user. The database checks permissions, balance and locks again.
 * `firmId` is the firm the form was opened in (null for supervisors): the entry is made for that firm,
 * even if the person has switched firm since. `entryId` makes a retry safe: saving the same id twice
 * returns the first entry instead of a copy. `replaces`: the entry this one takes the place of, cancelled in the same step.
 */
async function saveEntry(slug: string, firmId: string | null, data: FormData, db: Db, entryId?: string, replaces?: { id: string; reason: string }): Promise<Saved | FormState> {
  const form = getEntryForm(slug);
  const profile = await requireProfile();
  if (!form || !(form.roles as string[]).includes(profile.role)) return { errors: { _form: 'not_allowed' } };

  const values = submittedValues(data);
  const parsed = parseFields(form.fields, data);
  if (!parsed.ok) return { errors: parsed.errors, values };
  const allowed = firmsForSave(profile.role, await getWorkingFirm());
  const picked = allowed?.length ? await firmsPicked(form.fields, parsed.values, db) : {};
  const wrong = firmErrors(slug, form.fields, firmId, allowed, picked);
  if (wrong) return { errors: wrong, values };
  // Nothing is dated after today: a bill with a later date printed on it is typed when that day comes.
  if ((parsed.values.entry_date as string) > todayInIndia()) {
    return { errors: { entry_date: 'future_date' }, values };
  }
  if (slug === 'move-money' && parsed.values.from_account_id === parsed.values.to_account_id) {
    return { errors: { to_account_id: 'same_account' }, values };
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
  if (data.get('check') === '1') {
    const alike = await looksRepeated(db, draft, replaces?.id);
    if (alike) return { errors: { _form: 'maybe_repeat' }, detail: alike, values };
  }
  if (replaces) {
    const { data: done, error } = await db.rpc('app_replace_entry', { p_old_id: replaces.id, p_new: draft, p_reason: replaces.reason });
    if (error) return { errors: { _form: 'save_failed' }, detail: error.message, values };
    await clearSmallRemainder(db, draft);
    return (done as { entry: Saved }).entry;
  }
  const { data: result, error } = await db.rpc('app_post_entry', { p_entry: draft });
  if (error) return { errors: { _form: 'save_failed' }, detail: error.message, values };
  if (!(result as { duplicate?: boolean }).duplicate) await clearSmallRemainder(db, draft);
  return result as Saved;
}

/**
 * After an entry, clears anything under ₹1 left on its party, so it never comes back on a later bill. The entry itself
 * is already saved, so a failure here only leaves the remainder (still shown as nothing left) for the next entry.
 */
async function clearSmallRemainder(db: Db, draft: EntryDraft): Promise<void> {
  const line = partyLine(draft);
  if (!line?.firmId || !line.partyId) return;
  const { data, error } = await db.from('balances').select('amount_paise')
    .eq('account', line.account).eq('firm_id', line.firmId).eq('party_id', line.partyId);
  if (error) return console.error('round off:', error.message);
  const after = (data ?? []).reduce((sum, r) => sum + Number(r.amount_paise), 0);
  const before = after - draft.lines.filter((l) => l.account === line.account && l.partyId === line.partyId).reduce((sum, l) => sum + l.amountPaise, 0);
  const remainder = roundOffAmount(before, after);
  if (remainder === 0) return;
  const { error: postError } = await db.rpc('app_post_entry', { p_entry: roundOffDraft(line, remainder, draft.entryDate) });
  if (postError) console.error('round off:', postError.message);
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

/** What money not yet known can turn out to be, and which box of that form the account goes in. */
const SORTED: Record<'in' | 'out', Record<string, string>> = {
  in: { 'client-receipt': 'to_account_id', 'owner-money': 'account_id', 'other-money': 'account_id', 'move-money': 'to_account_id' },
  out: { 'pay-vendor': 'from_account_id', 'owner-money': 'account_id', 'other-money': 'account_id', 'move-money': 'from_account_id' },
};

/**
 * Money not yet known turns out to be something: the entry is cancelled and the right one posted, linked, in one step.
 * The account, the amount and the date are taken from the entry, never from the screen.
 */
export async function sortOut(entryId: string, _newId: string, slug: string, _firmId: string, cells: Record<string, string>): Promise<Saved | FormState> {
  const db = await createClient();
  const [{ data: entry }, { data: line }] = await Promise.all([
    db.from('entries').select('entry_date, firm_id').eq('id', entryId).eq('entry_type', 'not_yet_known').maybeSingle(),
    db.from('entry_lines').select('money_account_id, amount_paise').eq('entry_id', entryId).eq('account', 'money').maybeSingle(),
  ]);
  if (!entry || !line) return { errors: { _form: 'not_allowed' } };
  const amount = Number(line.amount_paise);
  const direction = amount > 0 ? 'in' : 'out';
  const box = SORTED[direction][slug];
  // What it turns out to be must go the way the money went.
  if (!box || (slug === 'other-money' && reasonOf(cells.reason ?? '')?.direction !== direction)) return { errors: { _form: 'not_allowed' } };
  const data = new FormData();
  for (const [name, value] of Object.entries(cells)) data.set(name, value);
  data.set('amount', String(Math.abs(amount) / 100));
  data.set('entry_date', entry.entry_date as string);
  data.set('direction', direction);
  data.set(box, line.money_account_id as string);
  const saved = await saveEntry(slug, entry.firm_id as string, data, db, undefined, { id: entryId, reason: 'Sorted out' });
  if ('id' in saved) revalidatePath('/', 'layout');
  return saved;
}

/** One entry from a bankbook pop-up. Stays on the page, which then shows the new balance. */
export async function postMoney(entryId: string, slug: string, firmId: string, cells: Record<string, string>): Promise<Saved | FormState> {
  return (await postEntryRows(slug, firmId, [{ id: entryId, cells }]))[entryId]!;
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
