'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { forecast } from '@/lib/forecast';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';
import { loadForecast } from './data';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

/** Adds money expected for the working firm: once, every week or every month. */
export async function addPlan(firmId: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const fail = (error: string): never => redirect(`/forecast?error=${error}#plans`);
  let amount = 0;
  try { amount = rupeesToPaise(text(data, 'amount')); } catch { /* checked below */ }
  const [name, direction, repeats, next, until] = ['name', 'direction', 'repeats', 'next_on', 'until_on'].map((f) => text(data, f)) as [string, string, string, string, string];
  if (!name || !(amount > 0) || !['in', 'out'].includes(direction) || !['once', 'week', 'month'].includes(repeats)) fail('plan');
  if (!DATE.test(next) || (until && (!DATE.test(until) || until < next))) fail('date');
  const { error } = await (await createClient()).from('planned_money')
    .insert({ firm_id: firmId, name, direction, amount_paise: amount, repeats, next_on: next, until_on: repeats === 'once' || !until ? null : until });
  if (error) fail('not_saved');
  revalidatePath('/forecast');
  redirect('/forecast#plans');
}

export async function removePlan(id: string): Promise<void> {
  await requireProfile('owner', 'office');
  await (await createClient()).from('planned_money').delete().eq('id', id);
  revalidatePath('/forecast');
  redirect('/forecast#plans');
}

/** Keeps today's forecast, to see later how close it was. Keeping it again on the same day replaces it. */
export async function keepForecast(all: boolean): Promise<void> {
  const profile = await requireProfile('owner', 'office');
  const working = await getWorkingFirm();
  if (!working || (all && profile.role !== 'owner')) redirect('/forecast');
  const db = await createClient();
  const today = todayInIndia();
  const { firms, shared } = await loadForecast(db, all ? working!.firms : [working!.firm], today);
  const weeks = forecast(firms.reduce((s, f) => s + f.held, 0), [...firms.flatMap((f) => f.items), ...(all ? shared.items : [])], today);
  const firmId = all ? null : working!.firm.id;
  const old = db.from('kept_forecasts').delete().eq('made_on', today);
  await (firmId ? old.eq('firm_id', firmId) : old.is('firm_id', null));
  await db.from('kept_forecasts').insert({ firm_id: firmId, made_on: today, weeks: weeks.map((w) => ({ end: w.to, closing: w.closing })) });
  revalidatePath('/forecast');
  redirect(`/forecast${all ? '?firms=all' : ''}#kept`);
}
