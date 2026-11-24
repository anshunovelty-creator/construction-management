'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { ratesToSave, type RateRow } from '@/lib/labour';
import { rupeesToPaise } from '@/lib/money';
import { sameName } from '@/lib/delete';
import { moveToBin } from '@/lib/bin';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ID = /^[0-9a-f-]{36}$/i;
const NUMBER = /^\d{1,3}(\.\d{1,2})?$/;
const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

function rupees(value: string): number | null {
  try {
    const paise = rupeesToPaise(value);
    return paise >= 0 ? paise : null;
  } catch {
    return null;
  }
}

type Db = Awaited<ReturnType<typeof createClient>>;

/** Saves changed day salaries, each counting from its month on, so that earlier months keep the salary they had. */
async function saveRates(db: Db, changes: RateRow[]): Promise<boolean> {
  const { data: have, error } = await db.from('labour_rates').select('worker_id, from_month, rate_paise')
    .in('worker_id', changes.map((c) => c.worker_id));
  if (error) return false;
  const { error: notSaved } = await db.from('labour_rates').upsert(ratesToSave(have as RateRow[], changes), { onConflict: 'worker_id,from_month' });
  return !notSaved;
}

/**
 * Adds a worker, or changes one. A changed day salary counts from the month chosen, so earlier months stay as they were.
 * A new worker heads a family of their own, or joins one (`head` = the head's id). A worker being changed can be moved
 * with `family`: "head" for their own family, or a head's id. A head with members or
 * money given stays the head (the database checks), and their family box then comes disabled and is not sent.
 */
export async function saveWorker(id: string | null, data: FormData): Promise<void> {
  const profile = await requireProfile('owner', 'office', 'labour');
  const head = id ? '' : text(data, 'head');
  if (head && head !== 'new' && !ID.test(head)) redirect('/labour');
  const form = id ? `/labour/${id}/edit` : `/labour/new${head ? `?head=${head}&` : '?'}`;
  const fail = (error: string): never => redirect(`${form}${id ? '?' : ''}error=${error}`);
  const name = text(data, 'name');
  if (!name) fail('name');
  // Said by the hour, the day's salary is 8 times it. A salary left as it was shown is not changed by the rounding.
  const unit = text(data, 'rate_unit') === 'hour' ? 'hour' : 'day';
  const daily = (paise: number | null) => (paise === null ? null : unit === 'hour' ? paise * 8 : paise);
  const untouched = id !== null && `${text(data, 'rate')}/${unit}` === text(data, 'old_said');
  const rate = untouched ? Number(text(data, 'old_rate')) : daily(rupees(text(data, 'rate')));
  if (rate === null || rate <= 0) fail('rate');
  const chargeText = text(data, 'charge');
  const charge = chargeText === '' ? null : daily(rupees(chargeText));
  if (chargeText !== '' && !charge) fail('charge');
  const today = todayInIndia();
  const fromMonth = id ? text(data, 'rate_from') : today.slice(0, 7);
  if (!MONTH.test(fromMonth)) fail('rate_from');
  const family = id && data.has('family') ? text(data, 'family') : null;
  if (family && family !== 'head' && (!ID.test(family) || family === id)) fail('not_saved');

  const details = { name, phone: text(data, 'phone'), skill: text(data, 'skill'), rate_unit: unit, is_active: id ? data.get('is_active') === 'on' : true };
  const db = await createClient();
  let workerId = id;
  let headId: string;
  if (id) {
    const moved = family === null ? {} : { head_id: family === 'head' ? id : family || null };
    const { data: row, error } = await db.from('labour_workers').update({ ...details, ...moved }).eq('id', id).select('head_id').single();
    if (error) fail(error.message.includes('stays the head') ? 'family_stays_head' : 'not_saved');
    headId = row!.head_id as string;
  } else {
    workerId = crypto.randomUUID();
    // A new worker heads a family of their own, unless added to a family.
    headId = head && head !== 'new' ? head : workerId;
    const { error } = await db.from('labour_workers').insert({ ...details, id: workerId, head_id: headId, kind: 'worker', joined_on: today });
    if (error) fail('not_saved');
  }
  if (!id || String(rate) !== text(data, 'old_rate')) {
    if (!await saveRates(db, [{ worker_id: workerId!, from_month: `${fromMonth}-01`, rate_paise: rate! }])) fail('not_saved');
  }
  // What a day is charged at, kept like the salary from a month on; emptied, the salary again. Never from a Labour login.
  if (profile.role !== 'labour' && data.has('charge') && String(charge ?? '') !== text(data, 'old_charge')) {
    const { error } = await db.from('labour_charge_rates')
      .upsert({ worker_id: workerId!, from_month: `${fromMonth}-01`, rate_paise: charge }, { onConflict: 'worker_id,from_month' });
    if (error) fail('not_saved');
  }
  revalidatePath('/labour', 'layout');
  redirect(`/labour/family/${headId}`);
}

/**
 * Deletes a worker added by mistake into the recycle bin: only one with nothing saved in any month, so no pay record is
 * ever lost (the database checks). A worker with months saved is switched off instead. The name must be typed first.
 */
export async function deleteWorker(id: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office', 'labour');
  const fail = (error: string): never => redirect(`/labour/${id}/edit?error=${error}`);
  const { data: worker } = await (await createClient()).from('labour_workers').select('name, head_id').eq('id', id).maybeSingle();
  if (!worker || !sameName(String(data.get('confirm') ?? ''), worker.name as string)) fail('delete_name');
  const refused = await moveToBin('labour-workers', id);
  if (refused) fail(refused.error === 'has_months' ? 'delete_has_months' : 'not_deleted');
  revalidatePath('/labour', 'layout');
  const head = worker!.head_id as string;
  redirect(head !== id ? `/labour/family/${head}` : '/labour');
}

export type MonthState = { error?: string; name?: string; saved?: number };
interface MonthRow {
  worker_id: string;
  month: string;
  present_days: number;
  ot_hours: number;
  advance_paise: number;
  deduction_paise: number;
  addition_paise: number;
  paid_paise: number;
  note: string;
}

/**
 * Saves the rows changed on the monthly entry and stays on the page, so a mistake loses nothing typed. A row emptied
 * of everything is taken off. Only changed rows arrive, so two people typing do not undo each other.
 */
export async function saveMonth(month: string, _: MonthState, data: FormData): Promise<MonthState> {
  await requireProfile('owner', 'office', 'labour');
  if (!MONTH.test(month) || month > todayInIndia().slice(0, 7)) return { error: 'date' };
  const rows: MonthRow[] = [];
  const rates: RateRow[] = [];
  for (const id of data.getAll('changed').map(String)) {
    const field = (name: string) => text(data, `${id}:${name}`);
    const fail = (error: string) => ({ error, name: field('name') });
    const days = field('days') || '0';
    const ot = field('ot') || '0';
    if (!NUMBER.test(days) || Number(days) > 100) return fail('days');
    if (!NUMBER.test(ot)) return fail('ot');
    const advance = rupees(field('advance') || '0');
    if (advance === null) return fail('amount');
    // A changed day salary counts from this month on, until it is changed again; earlier months keep theirs.
    if (field('rate')) {
      const rate = rupees(field('rate'));
      if (!rate) return fail('rate');
      if (String(rate) !== field('old_rate')) rates.push({ worker_id: id, from_month: `${month}-01`, rate_paise: rate });
    }
    rows.push({
      worker_id: id, month: `${month}-01`, present_days: Number(days), ot_hours: Number(ot),
      advance_paise: advance, deduction_paise: 0, addition_paise: 0, paid_paise: 0, note: field('note'),
    });
  }
  const isEmpty = (r: MonthRow) => !r.present_days && !r.ot_hours && !r.advance_paise && !r.deduction_paise && !r.addition_paise && !r.paid_paise && !r.note;
  const db = await createClient();
  // Paid is on the Pay tab, from an account, and additions and deductions are not typed any more: what an old month has stays.
  const { data: kept, error: notRead } = await db.from('labour_months').select('worker_id, deduction_paise, addition_paise, paid_paise').eq('month', `${month}-01`).in('worker_id', rows.map((r) => r.worker_id));
  if (notRead) return { error: 'not_saved' };
  const had = new Map((kept ?? []).map((k) => [k.worker_id as string, k]));
  for (const r of rows) {
    r.deduction_paise = Number(had.get(r.worker_id)?.deduction_paise ?? 0);
    r.addition_paise = Number(had.get(r.worker_id)?.addition_paise ?? 0);
    r.paid_paise = Number(had.get(r.worker_id)?.paid_paise ?? 0);
  }
  const filled = rows.filter((r) => !isEmpty(r));
  const emptied = rows.filter(isEmpty).map((r) => r.worker_id);
  if (filled.length > 0) {
    const { error } = await db.from('labour_months').upsert(filled, { onConflict: 'worker_id,month' });
    if (error) return { error: 'not_saved' };
  }
  if (emptied.length > 0) {
    const { error } = await db.from('labour_months').delete().eq('month', `${month}-01`).in('worker_id', emptied);
    if (error) return { error: 'not_saved' };
  }
  if (rates.length > 0 && !await saveRates(db, rates)) return { error: 'not_saved' };
  revalidatePath('/labour', 'layout');
  return { saved: rows.length };
}

/** Takes off a money line typed by mistake: the office and owner any time, the labour login its own lines on the same day. */
export async function removeFamilyMoney(headId: string, lineId: string, month: string): Promise<void> {
  await requireProfile('owner', 'office', 'labour');
  const { data, error } = await (await createClient()).from('labour_money').delete().eq('id', lineId).eq('worker_id', headId).select('id');
  revalidatePath('/labour', 'layout');
  redirect(`/labour/family/${headId}?month=${month}${data?.length ? '' : `&error=${error?.message.includes('paid together') ? 'paid_together' : 'not_removed'}`}#money`);
}

/**
 * Keeps a family's opening balance, from before the app: what we still had to pay them, or what they were paid extra,
 * counting from a month. One per family, against its head; saving again changes it, and an amount of 0 takes it off.
 */
export async function saveOpening(headId: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office', 'labour');
  const fail = (error: string): never => redirect(`/labour/family/${headId}/opening?error=${error}`);
  const month = text(data, 'month');
  if (!MONTH.test(month) || month > todayInIndia().slice(0, 7)) fail('date');
  const side = text(data, 'side');
  if (side !== 'pay' && side !== 'extra') fail('opening_side');
  const amount = rupees(text(data, 'amount'));
  if (amount === null) fail('amount');
  const db = await createClient();
  const { error } = amount === 0
    ? await db.from('labour_openings').delete().eq('worker_id', headId)
    : await db.from('labour_openings').upsert(
      { worker_id: headId, month: `${month}-01`, amount_paise: side === 'pay' ? amount : -amount!, note: text(data, 'note') },
      { onConflict: 'worker_id' },
    );
  if (error) fail('not_saved');
  revalidatePath('/labour', 'layout');
  redirect(`/labour/family/${headId}?month=${month}`);
}

/** Takes a family's opening balance off. */
export async function removeOpening(headId: string): Promise<void> {
  await requireProfile('owner', 'office', 'labour');
  const { error } = await (await createClient()).from('labour_openings').delete().eq('worker_id', headId);
  if (error) redirect(`/labour/family/${headId}/opening?error=not_saved`);
  revalidatePath('/labour', 'layout');
  redirect(`/labour/family/${headId}`);
}
