import { labourLedger, type LabourLedger, type LabourMoney, type LabourPerson, type LabourRate, type LabourSettings, type MonthDays } from '@/lib/labour';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;

export interface LabourWorker extends LabourPerson {
  id: string;
  name: string;
  phone: string;
  skill: string;
  uan: string;
  esic_number: string;
  is_active: boolean;
}
export type LabourLine = LabourWorker & { rates: LabourRate[]; days: MonthDays[]; money: LabourMoney[]; ledger: LabourLedger };

/** Every row of a table or view: the database hands back at most 1000 at a time. */
async function allRows<T>(db: Db, table: string, order: string[], filter?: [string, string]): Promise<T[]> {
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

/** The deduction rates kept, oldest first. */
export const loadSettings = (db: Db) => allRows<LabourSettings & { id: string }>(db, 'labour_settings', ['from_month']);

/** Everyone in the labour section (or one person), each with their running account up to today, A to Z. */
export async function loadLabour(db: Db, today: string, workerId?: string): Promise<{ settings: LabourSettings[]; people: LabourLine[] }> {
  const one = (column: string): [string, string] | undefined => (workerId ? [column, workerId] : undefined);
  const [settings, workers, rates, days, money] = await Promise.all([
    loadSettings(db),
    allRows<LabourWorker>(db, 'labour_workers', ['name', 'id'], one('id')),
    allRows<LabourRate & { worker_id: string }>(db, 'labour_rates', ['worker_id', 'from_month'], one('worker_id')),
    allRows<MonthDays & { worker_id: string }>(db, 'labour_month_days', ['worker_id', 'month'], one('worker_id')),
    allRows<LabourMoney & { worker_id: string }>(db, 'labour_money', ['money_date', 'created_at'], one('worker_id')),
  ]);
  const of = <T extends { worker_id: string }>(rows: T[], id: string) => rows.filter((r) => r.worker_id === id);
  const people = workers.map((w) => {
    const mine = { rates: of(rates, w.id), days: of(days, w.id), money: of(money, w.id) };
    return { ...w, ...mine, ledger: labourLedger(w, mine.rates, settings, mine.days, mine.money, today) };
  });
  return { settings, people };
}

/** "2026-11" as "November 2026". */
export const showMonth = (month: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${month}-01T00:00:00Z`));

/** The month asked for in the address, or this month. */
export const pickMonth = (asked: string | undefined, today: string) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(asked ?? '') ? asked! : today.slice(0, 7));
