'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { openingMoneyBalance } from '@/lib/ledger/posting/opening';
import { machineService } from '@/lib/ledger/posting/other';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';
import { payAccount } from '../pay/data';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

type Db = Awaited<ReturnType<typeof createClient>>;
const openingOf = async (db: Db, accountId: string) =>
  (await db.from('money_rows').select('entry_id').eq('money_account_id', accountId).eq('entry_type', 'opening').maybeSingle()).data?.entry_id as string | undefined;

/**
 * An account's opening balance: typed once, and changed by cancelling the old one with a reason and posting the new one
 * in its place. 0 takes it off. The database refuses one that leaves an entry before it, or cash below zero.
 */
export async function saveAccountOpening(accountId: string, data: FormData): Promise<void> {
  await requireProfile('owner');
  const fail = (error: string): never => redirect(`/bankbook/${accountId}/opening?error=${encodeURIComponent(error)}`);
  const date = text(data, 'date');
  if (!DATE.test(date) || date > todayInIndia()) fail('date');
  let amount = -1;
  try { amount = rupeesToPaise(text(data, 'amount') || '0'); } catch { /* checked below */ }
  if (!(amount >= 0)) fail('amount');
  const db = await createClient();
  const { data: account } = await db.from('money_accounts').select('id, kind, firm_id').eq('id', accountId).maybeSingle();
  if (!account?.firm_id) fail('amount');
  const overdrawn = text(data, 'side') === 'over';
  if (overdrawn && account!.kind !== 'bank') fail('cash_overdrawn');
  const old = await openingOf(db, accountId);
  const reason = text(data, 'reason');
  if (old && !reason) fail('reason');
  if (amount === 0 && !old) redirect(`/bankbook/${accountId}`);

  const { error } = amount === 0
    ? await db.rpc('app_reverse_entry', { p_entry_id: old, p_reason: reason })
    : await (async () => {
      const draft = openingMoneyBalance({
        account: { id: account!.id, kind: account!.kind, firmId: account!.firm_id }, amountPaise: overdrawn ? -amount : amount, asOf: date,
      });
      return old
        ? db.rpc('app_replace_entry', { p_old_id: old, p_new: draft, p_reason: reason })
        : db.rpc('app_post_entry', { p_entry: draft });
    })();
  if (error) fail(error.message);
  revalidatePath('/', 'layout');
  redirect(`/bankbook/${accountId}?month=${date.slice(0, 7)}`);
}

/** Takes an account's opening balance off, with a reason. */
export async function removeAccountOpening(accountId: string, data: FormData): Promise<void> {
  await requireProfile('owner');
  const fail = (error: string): never => redirect(`/bankbook/${accountId}/opening?error=${encodeURIComponent(error)}`);
  const reason = text(data, 'reason');
  if (!reason) fail('reason');
  const db = await createClient();
  const old = await openingOf(db, accountId);
  if (old) {
    const { error } = await db.rpc('app_reverse_entry', { p_entry_id: old, p_reason: reason });
    if (error) fail(error.message);
  }
  revalidatePath('/', 'layout');
  redirect(`/bankbook/${accountId}`);
}

/** Keeps a cash count, and records a difference from the books at the end of that day. */
export async function countCash(accountId: string, countId: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const page = `/bankbook/${accountId}/count`;
  const fail = (error: string): never => redirect(`${page}?error=${encodeURIComponent(error)}`);
  const date = text(data, 'date');
  let counted = -1;
  try { counted = rupeesToPaise(text(data, 'amount')); } catch { /* checked below */ }
  if (!DATE.test(date) || date > todayInIndia()) fail('Give a date up to today.');
  if (!(counted >= 0)) fail('Type the cash counted, in rupees.');
  const { data: result, error } = await (await createClient()).rpc('app_count_cash', {
    p_id: countId, p_account: accountId, p_date: date, p_counted: counted, p_note: text(data, 'note'),
  });
  if (error) fail(error.message);
  revalidatePath('/', 'layout');
  redirect(`${page}?done=${(result as { difference: number }).difference}`);
}

const unpaidFail = (error: string): never => redirect(`/bankbook/unpaid?error=${encodeURIComponent(error)}`);

/** A cost not paid yet came on a party's bill (so it is paid there), or did not after all. */
export async function markOnBill(kind: 'cost' | 'service', id: string, on: boolean): Promise<void> {
  await requireProfile('owner', 'office');
  const { error } = await (await createClient()).rpc('app_mark_on_bill', { p_kind: kind, p_id: id, p_on: on });
  if (error) unpaidFail(error.message);
  revalidatePath('/', 'layout');
  redirect('/bankbook/unpaid');
}

/** A machine's service typed as not paid yet, now paid from the working firm's bank or cash. */
export async function payService(id: string, entryId: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const db = await createClient();
  const paidOn = text(data, 'date');
  if (!DATE.test(paidOn) || paidOn > todayInIndia()) return unpaidFail('This date is in the future.');
  const [{ data: service }, account, working] = await Promise.all([
    db.from('machine_services').select('cost_paise, note, machine:machines(name)').eq('id', id).is('entry_id', null).maybeSingle<{ cost_paise: number | string; note: string; machine: { name: string } | null }>(),
    payAccount(db, text(data, 'account')), getWorkingFirm(),
  ]);
  if (!service) return unpaidFail('This cost is already paid or removed.');
  if (!account || account.firmId !== working?.firm.id) return unpaidFail('Choose one of this firm’s accounts.');
  const entry = machineService({ id: entryId, account, amountPaise: Number(service.cost_paise), date: paidOn, narration: [service.machine?.name, service.note].filter(Boolean).join(' · ') });
  const { error } = await db.rpc('app_pay_service', { p_service: id, p_entry: entry });
  if (error) unpaidFail(error.message);
  revalidatePath('/', 'layout');
  redirect('/bankbook/unpaid');
}
