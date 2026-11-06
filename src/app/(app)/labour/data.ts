import { labourLedger, type LabourMonth, type LabourRate, type LedgerMonth } from '@/lib/labour';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;

export interface LabourWorker {
  id: string;
  name: string;
  phone: string;
  skill: string;
  is_active: boolean;
}
export type LabourLine = LabourWorker & { rates: LabourRate[]; ledger: LedgerMonth[]; balance: number };

/** Every row of a table: the database hands back at most 1000 at a time. */
export async function allRows<T>(db: Db, table: string, order: string[], filter?: [string, string]): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    let query = db.from(table).select('*');
    if (filter) query = query.eq(filter[0], filter[1]);
    for (const column of order) query = query.order(column);
    const { data, error } = await query.range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data as T[]));
    if ((data ?? []).length < 1000) return rows;
  }
}

function byWorker<T extends { worker_id: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.worker_id, [...(groups.get(row.worker_id) ?? []), row]);
  return groups;
}

/** Everyone in the labour section (or one person) with their ledger, A to Z. `balance` is what their last month left. */
export async function loadLabour(db: Db, workerId?: string): Promise<LabourLine[]> {
  const one = (column: string): [string, string] | undefined => (workerId ? [column, workerId] : undefined);
  const [workers, rates, months] = await Promise.all([
    allRows<LabourWorker>(db, 'labour_workers', ['name', 'id'], one('id')),
    allRows<LabourRate & { worker_id: string }>(db, 'labour_rates', ['worker_id', 'from_month'], one('worker_id')),
    allRows<LabourMonth & { worker_id: string }>(db, 'labour_months', ['worker_id', 'month'], one('worker_id')),
  ]);
  const ratesOf = byWorker(rates);
  const monthsOf = byWorker(months);
  return workers.map((w) => {
    const mine = ratesOf.get(w.id) ?? [];
    const ledger = labourLedger(monthsOf.get(w.id) ?? [], mine);
    return { ...w, rates: mine, ledger, balance: ledger.at(-1)?.balance ?? 0 };
  });
}

/** "2026-11" as "November 2026". */
export const showMonth = (month: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${month}-01T00:00:00Z`));

/** The month asked for in the address, or this month. */
export const pickMonth = (asked: string | undefined, today: string) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(asked ?? '') ? asked! : today.slice(0, 7));
