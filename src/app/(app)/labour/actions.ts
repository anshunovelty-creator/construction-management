'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
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

/** Adds a worker, or changes one. A changed day salary counts from the month chosen, so earlier months stay as they were. */
export async function saveWorker(id: string | null, data: FormData): Promise<void> {
  await requireProfile('owner', 'office', 'labour');
  const form = id ? `/labour/${id}/edit` : '/labour/new';
  const fail = (error: string): never => redirect(`${form}?error=${error}`);
  const name = text(data, 'name');
  if (!name) fail('name');
  const rate = rupees(text(data, 'rate'));
  if (rate === null || rate <= 0) fail('rate');
  const today = todayInIndia();
  const fromMonth = id ? text(data, 'rate_from') : today.slice(0, 7);
  if (!MONTH.test(fromMonth)) fail('rate_from');

  const details = { name, phone: text(data, 'phone'), skill: text(data, 'skill'), is_active: id ? data.get('is_active') === 'on' : true };
  const db = await createClient();
  let workerId = id;
  if (id) {
    const { error } = await db.from('labour_workers').update(details).eq('id', id);
    if (error) fail('not_saved');
  } else {
    const { data: row, error } = await db.from('labour_workers').insert({ ...details, kind: 'worker', joined_on: today }).select('id').single();
    if (error || !row) fail('not_saved');
    workerId = row!.id as string;
  }
  if (!id || String(rate) !== text(data, 'old_rate')) {
    const { error } = await db.from('labour_rates')
      .upsert({ worker_id: workerId, from_month: `${fromMonth}-01`, rate_paise: rate }, { onConflict: 'worker_id,from_month' });
    if (error) fail('not_saved');
  }
  revalidatePath('/labour', 'layout');
  redirect(`/labour/${workerId}`);
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
  for (const id of data.getAll('changed').map(String)) {
    const field = (name: string) => text(data, `${id}:${name}`);
    const fail = (error: string) => ({ error, name: field('name') });
    const days = field('days') || '0';
    const ot = field('ot') || '0';
    if (!NUMBER.test(days) || Number(days) > 100) return fail('days');
    if (!NUMBER.test(ot)) return fail('ot');
    const [advance, deduction, addition, paid] = ['advance', 'deduction', 'addition', 'paid'].map((n) => rupees(field(n) || '0'));
    if (advance == null || deduction == null || addition == null || paid == null) return fail('amount');
    rows.push({
      worker_id: id, month: `${month}-01`, present_days: Number(days), ot_hours: Number(ot),
      advance_paise: advance, deduction_paise: deduction, addition_paise: addition, paid_paise: paid, note: field('note'),
    });
  }
  const isEmpty = (r: MonthRow) => !r.present_days && !r.ot_hours && !r.advance_paise && !r.deduction_paise && !r.addition_paise && !r.paid_paise && !r.note;
  const db = await createClient();
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
  revalidatePath('/labour', 'layout');
  return { saved: rows.length };
}
