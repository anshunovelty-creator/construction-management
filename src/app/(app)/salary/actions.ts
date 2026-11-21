'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ID = /^[0-9a-f-]{36}$/i;
const KINDS = ['advance', 'payment', 'deduction'] as const;
const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

/**
 * Keeps money given to a worker or staff member, or taken off, with its date: an advance or a payment says cash or
 * bank, and a deduction says why. `back` is the slip's query (its period), so the page opens where it was.
 */
export async function addSalaryMoney(partyId: string, back: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const page = `/salary/${partyId}?${back}`;
  const fail = (error: string): never => redirect(`${page}&error=${error}#money`);
  const date = text(data, 'date');
  if (!DATE.test(date) || date > todayInIndia()) fail('money_date');
  const kind = text(data, 'kind') as (typeof KINDS)[number];
  if (!KINDS.includes(kind)) fail('kind');
  let amount = 0;
  try { amount = rupeesToPaise(text(data, 'amount')); } catch { /* checked below */ }
  if (!(amount > 0)) fail('amount');
  const method = kind === 'deduction' ? null : text(data, 'method');
  if (method !== null && method !== 'cash' && method !== 'bank') fail('method');
  const note = text(data, 'note');
  if (kind === 'deduction' && !note) fail('reason');
  const { error } = await (await createClient()).from('salary_money')
    .insert({ party_id: partyId, money_date: date, kind, amount_paise: amount, method, note });
  if (error) fail('not_saved');
  revalidatePath('/salary', 'layout');
  redirect(`${page}#money`);
}

/** Takes off a money line typed by mistake. */
export async function removeSalaryMoney(partyId: string, lineId: string, back: string): Promise<void> {
  await requireProfile('owner', 'office');
  const { data } = await (await createClient()).from('salary_money').delete().eq('id', lineId).eq('party_id', partyId).select('id');
  revalidatePath('/salary', 'layout');
  redirect(`/salary/${partyId}?${back}${data?.length ? '' : '&error=not_removed'}#money`);
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
