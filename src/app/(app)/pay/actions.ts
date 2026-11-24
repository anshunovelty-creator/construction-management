'use server';

import { revalidatePath } from 'next/cache';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { wagesPaid } from '@/lib/ledger/posting/other';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';
import { labourFirm, payAccount } from './data';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PayKind = 'payment' | 'advance' | 'returned';
export interface PayInput { entryId: string; accountId: string; date: string; kind: PayKind; note: string; lines: { id: string; amount: string }[]; /** Saved even though someone was given the same amount that day. */ anyway?: boolean }
export type PayResult = { error: string; detail?: string } | { serial: string };

/**
 * Gives salary, wages or an advance to one person or many from one account, as one line in its bankbook; or takes back
 * money handed in. The database checks access, cash and that the lines add up.
 */
export async function payPeople(source: 'salary' | 'labour', input: PayInput): Promise<PayResult> {
  await requireProfile('owner', 'office');
  if (!DATE.test(input.date) || input.date > todayInIndia() || !UUID.test(input.entryId)) return { error: 'money_date' };
  if (!['payment', 'advance', 'returned'].includes(input.kind)) return { error: 'kind' };
  const lines: { source: string; id: string; kind: PayKind; amountPaise: number; note: string }[] = [];
  for (const line of input.lines) {
    if (!line.amount.trim()) continue;
    let amountPaise = 0;
    try { amountPaise = rupeesToPaise(line.amount); } catch { /* refused next */ }
    if (!(amountPaise > 0) || !UUID.test(line.id)) return { error: 'amount' };
    lines.push({ source, id: line.id, kind: input.kind, amountPaise, note: input.note.trim() });
  }
  if (lines.length === 0) return { error: 'amount' };
  const db = await createClient();
  const account = await payAccount(db, input.accountId);
  if (!account) return { error: 'account' };
  // Each firm pays from its own: salaries from the working firm, workers from the firm that runs Labour payment.
  const firm = source === 'labour' ? await labourFirm(db) : (await getWorkingFirm())?.firm;
  if (!firm || firm.id !== account.firmId) return { error: 'account' };
  if (!input.anyway) {
    const [table, column] = source === 'salary' ? ['salary_money', 'party_id'] as const : ['labour_money', 'worker_id'] as const;
    const { data: given } = await db.from(table).select(`${column}, amount_paise`).eq('money_date', input.date).eq('kind', input.kind).in(column, lines.map((l) => l.id));
    const same = lines.filter((l) => (given as unknown as Record<string, string | number>[] ?? []).some((g) => g[column] === l.id && Number(g.amount_paise) === l.amountPaise));
    if (same.length > 0) {
      const { data: people } = await db.from(source === 'salary' ? 'parties' : 'labour_workers').select('name').in('id', same.map((l) => l.id));
      return { error: 'paid_twice', detail: (people ?? []).map((p) => p.name as string).join(', ') };
    }
  }
  const names = await db.from(source === 'salary' ? 'parties' : 'labour_workers').select('id, name').in('id', lines.slice(0, 3).map((l) => l.id));
  const who = (names.data ?? []).map((n) => n.name as string).join(', ') + (lines.length > 3 ? ` +${lines.length - 3}` : '');
  const total = lines.reduce((s, l) => s + l.amountPaise, 0);
  const entry = wagesPaid({
    id: input.entryId, account, amountPaise: input.kind === 'returned' ? -total : total, date: input.date,
    narration: [who, input.note.trim()].filter(Boolean).join(' · '),
  });
  const { data, error } = await db.rpc('app_pay', { p_batches: [{ entry, lines }] });
  if (error) return { error: 'not_saved', detail: error.message };
  revalidatePath('/', 'layout');
  return { serial: (data as { serial: string }[])[0]!.serial };
}
