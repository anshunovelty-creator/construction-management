'use server';

import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../../entries/data';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MatchInput { date: string; balance: string; overdrawn: boolean; ticks: { id: string; clearedOn: string }[]; unticks: string[] }

/** Keeps a bank statement's balance on its date, with the lines the bank has by then. Ticks can be taken off again. */
export async function saveMatch(accountId: string, input: MatchInput): Promise<{ error: string; detail?: string } | { saved: true }> {
  await requireProfile('owner', 'office');
  const today = todayInIndia();
  if (!DATE.test(input.date) || input.date > today) return { error: 'date' };
  let balance = 0;
  try { balance = rupeesToPaise(input.balance || '0'); } catch { return { error: 'amount' }; }
  if (balance < 0) return { error: 'amount' };
  if (!input.ticks.every((t) => UUID.test(t.id) && DATE.test(t.clearedOn) && t.clearedOn <= today) || !input.unticks.every((id) => UUID.test(id))) return { error: 'date' };
  const db = await createClient();
  if (input.unticks.length > 0) {
    const { error } = await db.from('bank_ticks').delete().eq('money_account_id', accountId).in('entry_id', input.unticks);
    if (error) return { error: 'not_saved', detail: error.message };
  }
  if (input.ticks.length > 0) {
    const { error } = await db.from('bank_ticks').upsert(
      input.ticks.map((t) => ({ entry_id: t.id, money_account_id: accountId, cleared_on: t.clearedOn })), { onConflict: 'entry_id,money_account_id' });
    if (error) return { error: 'not_saved', detail: error.message };
  }
  const { error } = await db.from('bank_statements').upsert(
    { money_account_id: accountId, statement_date: input.date, balance_paise: input.overdrawn ? -balance : balance }, { onConflict: 'money_account_id,statement_date' });
  if (error) return { error: 'not_saved', detail: error.message };
  revalidatePath('/', 'layout');
  return { saved: true };
}
