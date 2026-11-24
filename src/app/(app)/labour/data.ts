import { familyLedger, labourLedger, rateFor, type LabourMoney, type LabourOpening, type LabourMonth, type LabourRate, type LedgerMonth } from '@/lib/labour';
import type { createClient } from '@/lib/supabase/server';
import type { GridFamily } from './month/month-grid';

type Db = Awaited<ReturnType<typeof createClient>>;

export interface LabourWorker {
  id: string;
  name: string;
  phone: string;
  skill: string;
  is_active: boolean;
  /** A head of family's own id (a single worker heads a family of one), or a member's head. */
  head_id: string;
  /** How their salary is said; the day's salary is what is kept. */
  rate_unit: 'day' | 'hour';
}
export type LabourLine = LabourWorker & { rates: LabourRate[]; months: LabourMonth[]; ledger: LedgerMonth[]; balance: number };

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
    const months = monthsOf.get(w.id) ?? [];
    const ledger = labourLedger(months, mine);
    return { ...w, rates: mine, months, ledger, balance: ledger.at(-1)?.balance ?? 0 };
  });
}

export type MoneyLine = LabourMoney & { id: string; method: 'cash' | 'bank' | null; note: string; created_at: string; entry_id: string | null };
export interface Family {
  head: LabourLine;
  /** The head first, then the members A to Z. */
  members: LabourLine[];
  money: MoneyLine[];
  opening: (LabourOpening & { note: string }) | null;
  ledger: LedgerMonth[];
  balance: number;
}

/** Every family (or one, by its head), with the money given to the head and the family's ledger: single workers A to Z, then families A to Z. */
export async function loadFamilies(db: Db, headId?: string): Promise<Family[]> {
  const one = headId ? ['worker_id', headId] as [string, string] : undefined;
  const [people, money, openings] = await Promise.all([
    loadLabour(db),
    allRows<MoneyLine & { worker_id: string }>(db, 'labour_money', ['money_date', 'created_at'], one),
    allRows<LabourOpening & { worker_id: string; note: string }>(db, 'labour_openings', ['worker_id'], one),
  ]);
  const moneyOf = byWorker(money);
  const openingOf = new Map(openings.map((o) => [o.worker_id, o]));
  return people.filter((p) => p.head_id === p.id && (!headId || p.id === headId)).map((head) => {
    const members = [head, ...people.filter((p) => p.head_id === head.id && p.id !== head.id)];
    const mine = moneyOf.get(head.id) ?? [];
    const opening = openingOf.get(head.id) ?? null;
    const ledger = familyLedger(members, mine, opening);
    return { head, members, money: mine, opening, ledger, balance: ledger.at(-1)?.balance ?? 0 };
  }).sort((a, b) => Number(a.members.length > 1) - Number(b.members.length > 1));
}

const box = (value: number | undefined) => (value ? String(value) : '');
const rupeeBox = (paise: number | undefined) => (paise ? String(paise / 100) : '');
const net = (m: LedgerMonth | undefined) => (m ? m.addition - m.deduction - m.advance : 0);

/**
 * A family's rows on the monthly entry for a month ("2026-11"), and what the month left. Members who have left show
 * only when the month has their days. The family's advance is typed on the head; what is kept elsewhere for the month
 * (advances given on Pay, a member's from before they joined, old additions and deductions) is counted as it is.
 */
export function familyGrid(f: Family, month: string): { grid: GridFamily; month?: LedgerMonth; left: number } {
  const mine = f.ledger.find((l) => l.month === month);
  // An opening balance counting from this month is in this month's "from last month".
  const before = mine?.before ?? f.ledger.filter((l) => l.month < month).at(-1)?.balance ?? 0;
  const headMonth = f.head.ledger.find((l) => l.month === month);
  const members = f.members.filter((m) => m.id === f.head.id || m.is_active || m.ledger.some((l) => l.month === month)).map((m) => {
    const l = m.ledger.find((x) => x.month === month);
    return {
      id: m.id, name: m.name, skill: m.skill, rate: rateFor(m.rates, month), days: box(l?.days), ot: box(l?.otHours),
      advance: rupeeBox(l?.advance), paid: rupeeBox(l?.paid), note: l?.note ?? '',
    };
  });
  return {
    grid: { members, before, otherNet: net(mine) + (headMonth?.advance ?? 0), otherPaid: (mine?.paid ?? 0) - (headMonth?.paid ?? 0), otherAdvance: (mine?.advance ?? 0) - (headMonth?.advance ?? 0) },
    month: mine,
    left: mine?.balance ?? before,
  };
}

/** "2026-11" as "November 2026". */
export const showMonth = (month: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${month}-01T00:00:00Z`));

/** The month asked for in the address, or this month. */
export const pickMonth = (asked: string | undefined, today: string) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(asked ?? '') ? asked! : today.slice(0, 7));
