'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const NUMBER = /^\d{1,3}(\.\d{1,2})?$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID = /^[0-9a-f-]{36}$/i;
const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

/**
 * A deduction from a worker's or staff member's salary, with its date and why. Money given is paid on the Pay card, from
 * an account (payPeople). `back` is the slip's query (its period), so the page opens where it was.
 */
export async function addSalaryMoney(partyId: string, back: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const page = `/salary/${partyId}?${back}`;
  const fail = (error: string): never => redirect(`${page}&error=${error}#money`);
  const date = text(data, 'date');
  if (!DATE.test(date) || date > todayInIndia()) fail('money_date');
  let amount = 0;
  try { amount = rupeesToPaise(text(data, 'amount')); } catch { /* checked below */ }
  if (!(amount > 0)) fail('amount');
  const note = text(data, 'note');
  if (!note) fail('reason');
  const { error } = await (await createClient()).from('salary_money')
    .insert({ party_id: partyId, money_date: date, kind: 'deduction', amount_paise: amount, note });
  if (error) fail('not_saved');
  revalidatePath('/salary', 'layout');
  redirect(`${page}#money`);
}

/** Takes off a money line typed by mistake. */
export async function removeSalaryMoney(partyId: string, lineId: string, back: string): Promise<void> {
  await requireProfile('owner', 'office');
  const { data, error } = await (await createClient()).from('salary_money').delete().eq('id', lineId).eq('party_id', partyId).select('id');
  revalidatePath('/salary', 'layout');
  redirect(`/salary/${partyId}?${back}${data?.length ? '' : `&error=${error?.message.includes('paid together') ? 'paid_together' : 'not_removed'}`}#money`);
}

/**
 * Cuts PF, or stops cutting it, for these people from a month ("2026-11") on, until switched again; earlier months
 * keep what they had. Saved in place (no redirect), so the page does not reload around the switch.
 */
export async function switchPf(partyIds: string[], month: string, cut: boolean): Promise<void> {
  await requireProfile('owner', 'office');
  if (!MONTH.test(month) || partyIds.length === 0 || !partyIds.every((id) => ID.test(id))) return;
  const rows = partyIds.map((party_id) => ({ party_id, from_month: `${month}-01`, cut }));
  await (await createClient()).from('salary_pf').upsert(rows, { onConflict: 'party_id,from_month' });
  revalidatePath('/salary', 'layout');
}

/**
 * A person's opening balance: what was left with them before the app, counted in the month chosen and carried on from
 * there. One per person; saving again replaces it, and 0 takes it off.
 */
export async function saveSalaryOpening(partyId: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const fail = (error: string): never => redirect(`/salary/${partyId}/opening?error=${error}`);
  const month = text(data, 'month');
  if (!MONTH.test(month) || month > todayInIndia().slice(0, 7)) fail('date');
  const side = text(data, 'side');
  if (side !== 'pay' && side !== 'extra') fail('opening_side');
  let amount = -1;
  try { amount = rupeesToPaise(text(data, 'amount') || '0'); } catch { /* checked below */ }
  if (!(amount >= 0)) fail('amount');
  const db = await createClient();
  const { error } = amount === 0
    ? await db.from('salary_openings').delete().eq('party_id', partyId)
    : await db.from('salary_openings').upsert(
      { party_id: partyId, month: `${month}-01`, amount_paise: side === 'pay' ? amount : -amount, note: text(data, 'note') },
      { onConflict: 'party_id' },
    );
  if (error) fail('not_saved');
  revalidatePath('/salary', 'layout');
  redirect(`/salary/${partyId}?month=${month}`);
}

/** Takes a person's opening balance off. */
export async function removeSalaryOpening(partyId: string): Promise<void> {
  await requireProfile('owner', 'office');
  const { error } = await (await createClient()).from('salary_openings').delete().eq('party_id', partyId);
  if (error) redirect(`/salary/${partyId}/opening?error=not_saved`);
  revalidatePath('/salary', 'layout');
  redirect(`/salary/${partyId}`);
}

export type MonthState = { error?: string; name?: string; saved?: number };

/**
 * The workers' pay per day, days, OT hours and salary of a month, as typed on Salary → Skill. Only the workers changed are sent.
 * The salary is kept as typed (the sheet fills it in from the pay per day). Nothing comes from the rate in Setup: it is the daily report's price, not what they are paid.
 */
export async function saveSalaryMonth(month: string, _: MonthState, data: FormData): Promise<MonthState> {
  await requireProfile('owner', 'office');
  if (!MONTH.test(month) || month > todayInIndia().slice(0, 7)) return { error: 'date' };
  const rows: { party_id: string; month: string; days: number; ot_hours: number; day_pay_paise: number; salary_paise: number }[] = [];
  for (const id of data.getAll('changed').map(String)) {
    const field = (name: string) => text(data, `${id}:${name}`);
    const fail = (error: string) => ({ error, name: field('name') });
    if (!ID.test(id)) return { error: 'not_saved' };
    const days = field('days') || '0';
    const ot = field('ot') || '0';
    if (!NUMBER.test(days) || Number(days) > 100) return fail('days');
    if (!NUMBER.test(ot)) return fail('ot');
    let [pay, salary] = [-1, -1];
    try { pay = rupeesToPaise(field('pay') || '0'); salary = rupeesToPaise(field('salary') || '0'); } catch { /* checked below */ }
    if (!(pay >= 0 && salary >= 0)) return fail('amount');
    rows.push({ party_id: id, month: `${month}-01`, days: Number(days), ot_hours: Number(ot), day_pay_paise: pay, salary_paise: salary });
  }
  const isEmpty = (r: (typeof rows)[number]) => !r.days && !r.ot_hours && !r.day_pay_paise && !r.salary_paise;
  const filled = rows.filter((r) => !isEmpty(r));
  const emptied = rows.filter(isEmpty).map((r) => r.party_id);
  const db = await createClient();
  if (filled.length > 0) {
    const { error } = await db.from('salary_months').upsert(filled, { onConflict: 'party_id,month' });
    if (error) return { error: 'not_saved' };
  }
  if (emptied.length > 0) {
    const { error } = await db.from('salary_months').delete().eq('month', `${month}-01`).in('party_id', emptied);
    if (error) return { error: 'not_saved' };
  }
  revalidatePath('/salary', 'layout');
  return { saved: rows.length };
}
