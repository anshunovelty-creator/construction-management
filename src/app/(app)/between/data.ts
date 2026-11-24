import type { ListPerson } from '@/components/pay-list';
import type { createClient } from '@/lib/supabase/server';
import { allRows } from '../labour/data';

type Db = Awaited<ReturnType<typeof createClient>>;

/** One live entry of two firms' running account, from `firm_id`'s side (view `firm_rows`). Above zero: given, so the other firm owes more. */
export interface FirmRow {
  firm_id: string;
  counter_firm_id: string;
  entry_id: string;
  serial: string;
  entry_type: string;
  entry_date: string;
  party_id: string | null;
  reference: string;
  narration: string;
  amount_paise: number | string;
  balance_paise: number | string;
  money_account_id: string | null;
  site_id: string | null;
}
export interface OurFirm { id: string; name: string; runs_labour: boolean }

export const loadFirms = async (db: Db): Promise<OurFirm[]> =>
  (await db.from('firms').select('id, name, runs_labour').order('name').returns<OurFirm[]>()).data ?? [];

/** The other firms as lines of a Pay (side "party") or Receive list: what came, what was given back, and what is left. */
export async function loadFirmLines(db: Db, firmId: string, others: OurFirm[], side: 'party' | 'client'): Promise<ListPerson[]> {
  const rows = await allRows<Pick<FirmRow, 'counter_firm_id' | 'amount_paise' | 'entry_date'>>(db, 'firm_rows', ['entry_date', 'entry_id'], ['firm_id', firmId]);
  return others.map((o) => {
    // From this list's side: what makes more due is above zero, what settles it below.
    const mine = rows.filter((r) => r.counter_firm_id === o.id).map((r) => ({ date: r.entry_date, amount: Number(r.amount_paise) * (side === 'party' ? -1 : 1) }));
    const total = mine.reduce((s, r) => s + Math.max(r.amount, 0), 0);
    const done = mine.reduce((s, r) => s + Math.max(-r.amount, 0), 0);
    // One account has two sides: its sums are said only on the list where something is due, or they would be added twice.
    const due = total > done;
    return { id: o.id, name: o.name, total: due ? total : 0, done: due ? done : 0, left: total - done, last: mine.filter((r) => r.amount < 0).at(-1)?.date ?? null, firm: true };
  });
}

/** What each firm owes each other firm now: `dues.get("a/b")` above zero means firm b owes firm a. */
export async function loadDues(db: Db): Promise<Map<string, number>> {
  const { data, error } = await db.from('balances').select('firm_id, counter_firm_id, amount_paise').eq('account', 'inter_firm');
  if (error) throw new Error(error.message);
  const dues = new Map<string, number>();
  for (const r of data ?? []) {
    const key = `${r.firm_id}/${r.counter_firm_id}`;
    dues.set(key, (dues.get(key) ?? 0) + Number(r.amount_paise));
  }
  return dues;
}
