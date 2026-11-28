import { roundOffSmall, type Paise } from '@/lib/money';

/** A worker's rate in Setup is per hour, the daily report's price (what they are paid is typed on Salary → Skill); staff's is a fixed salary per month, with no OT and nothing cut for leave. */
export type PersonKind = 'worker' | 'staff';

/** Days in the month of "2026-11-02": 30. */
export const daysInMonth = (date: string): number => {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * A day's price on the daily report, in paise: 8 hours at a worker's hourly rate (not what they are paid: that is typed), or for staff a day's share of the month's salary (what the
 * day costs the site they are at; their salary itself stays fixed, see staffSalary).
 */
export const dayPay = (kind: PersonKind, ratePaise: number, date: string): number =>
  (kind === 'worker' ? ratePaise * 8 : Math.round(ratePaise / daysInMonth(date)));

/** The month-sized parts of from–to: ["2026-10-20", "2026-10-31"], ["2026-11-01", "2026-11-05"]. */
export function monthParts(from: string, to: string): [string, string][] {
  const parts: [string, string][] = [];
  for (let day = from; day <= to;) {
    const last = `${day.slice(0, 7)}-${String(daysInMonth(day)).padStart(2, '0')}`;
    parts.push([day, to < last ? to : last]);
    day = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  return parts;
}

/** Staff salary for from–to: the whole month's salary for each full month, by calendar days for part of one. */
export const staffSalary = (monthlyPaise: number, from: string, to: string): number =>
  monthParts(from, to).reduce((total, [a, b]) =>
    total + Math.round((monthlyPaise * (Number(b.slice(8)) - Number(a.slice(8)) + 1)) / daysInMonth(a)), 0);

/**
 * The day's amount: a full day's pay when present (half of it, to the paisa, on a half day), plus each OT hour at a day's
 * pay ÷ 8. Whole numbers until the last step, so it matches the database's check to the paisa.
 */
export const dayAmount = (present: boolean, otCenti: number, dayPayPaise: number, half = false): number =>
  (present ? (half ? Math.round(dayPayPaise / 2) : dayPayPaise) : 0) + Math.round((otCenti * dayPayPaise) / 800);

/** OT hours as typed ("2", "1.5"), in hundredths of an hour; empty is none. Throws when not 0–16 with 2 decimals at most. */
export function otCenti(text: string): number {
  const cleaned = text.trim();
  if (cleaned === '') return 0;
  if (!/^(\d{1,2}(\.\d{0,2})?|\.\d{1,2})$/.test(cleaned)) throw new Error('bad_ot');
  const centi = Math.round(Number(cleaned) * 100);
  if (centi > 1600) throw new Error('bad_ot');
  return centi;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The salary period asked for: a whole month ("2026-10"), from–to dates (either way round), or else this month up to today. */
export function salaryPeriod(q: { month?: string; from?: string; to?: string }, today: string): { from: string; to: string; month?: string } {
  if (/^\d{4}-\d{2}$/.test(q.month ?? '')) {
    const [y, m] = q.month!.split('-').map(Number) as [number, number];
    return { from: `${q.month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), month: q.month };
  }
  if (DATE.test(q.from ?? '') && DATE.test(q.to ?? '')) {
    return q.from! <= q.to! ? { from: q.from!, to: q.to! } : { from: q.to!, to: q.from! };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today, month: today.slice(0, 7) };
}

/** The month before "2026-10": "2026-09". */
export const lastMonth = (month: string): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** A PF rate from Setup → PF rates, counting from the month of `from_date` on. */
export interface PfRate { from_date: string; rate_bp: number | string }

/**
 * The PF rate for a month ("2026-11"), in basis points: the latest from that month or before, else 12%.
 * ponytail: no ₹15,000 wage ceiling; add one when a salary above it must cut less.
 */
export function pfRate(rates: PfRate[], month: string): number {
  const last = [...rates].sort((a, b) => a.from_date.localeCompare(b.from_date)).filter((r) => r.from_date.slice(0, 7) <= month).at(-1);
  return last ? Number(last.rate_bp) : 1200;
}

/** Money given to a worker or staff member (paid, or an advance), or taken off (a deduction), with its date. */
export interface SalaryMoney { money_date: string; kind: 'advance' | 'payment' | 'deduction' | 'returned'; amount_paise: number | string }

/** PF switched on or off from a month ("2026-11-01") on, until switched again. */
export interface PfSwitch { from_month: string; cut: boolean }

/** Whether PF is cut in a month ("2026-11"): the latest switch at or before it; with none, staff yes and workers no. */
export function pfCut(kind: PersonKind, switches: PfSwitch[], month: string): boolean {
  const last = [...switches].sort((a, b) => a.from_month.localeCompare(b.from_month))
    .filter((s) => s.from_month.slice(0, 7) <= month).at(-1);
  return last ? last.cut : kind === 'staff';
}

/** A worker's month as typed on Salary → Skill (nothing here comes from the daily report). It counts on the 1st of its month. */
export interface TypedMonth { month: string; days: number | string; ot_hours: number | string; day_pay_paise?: number | string; salary_paise: number | string }

/**
 * What a worker is paid a day in a month ("2026-11"), in paise: the last typed for that month or before; for months
 * before the first typed, that first one; 0 when none. Only offered while typing: a saved salary is an amount.
 */
export function payPerDay(months: TypedMonth[], month: string): number {
  const typed = months.filter((m) => Number(m.day_pay_paise ?? 0) > 0).sort((a, b) => a.month.localeCompare(b.month));
  return Number((typed.filter((m) => m.month.slice(0, 7) <= month).at(-1) ?? typed[0])?.day_pay_paise ?? 0);
}

/** One worker or staff member, with everything that counts on their account. */
export interface SalaryPerson {
  kind: PersonKind;
  /** Staff: salary per month. */
  ratePaise: number;
  /** The days they can earn in: staff are paid every day of it; workers for the months typed. */
  from: string;
  to: string;
  /** Workers only: staff have a fixed salary. */
  months: TypedMonth[];
  money: SalaryMoney[];
  pf: PfSwitch[];
  pfRates: PfRate[];
  /** What was left with them before the app: counts in its month ("2026-10-01") as if from the month before. */
  opening?: SalaryOpening | null;
}

/** A balance from before the app: above zero we still had to pay them, below zero they had been paid extra. */
export interface SalaryOpening { month: string; amount_paise: number | string }

export interface SalaryFigures {
  days: number;
  otHours: number;
  salary: Paise;
  pf: Paise;
  advance: Paise;
  deduction: Paise;
  /** Salary less PF, advance and deduction: what is left to pay them for these days. */
  net: Paise;
  paid: Paise;
}

/** From–to dates: the salary earned, PF cut on it month by month, and the money given or taken off with a date in it. */
export function salaryFigures(p: SalaryPerson, from: string, to: string): SalaryFigures {
  const f = { days: 0, otHours: 0, salary: 0, pf: 0, advance: 0, deduction: 0, net: 0, paid: 0 };
  const [a0, b0] = [from > p.from ? from : p.from, to < p.to ? to : p.to];
  for (const [a, b] of a0 <= b0 ? monthParts(a0, b0) : []) {
    const typed = p.kind === 'worker' ? p.months.filter((m) => m.month >= a && m.month <= b) : [];
    const salary = p.kind === 'staff' ? staffSalary(p.ratePaise, a, b) : typed.reduce((t, m) => t + Number(m.salary_paise), 0);
    f.days += typed.reduce((t, m) => t + Number(m.days), 0);
    f.otHours += typed.reduce((t, m) => t + Number(m.ot_hours), 0);
    f.salary += salary;
    if (pfCut(p.kind, p.pf, a.slice(0, 7))) f.pf += Math.round((salary * pfRate(p.pfRates, a.slice(0, 7))) / 10_000);
  }
  for (const m of p.money) {
    if (m.money_date < from || m.money_date > to) continue;
    // Handed back: that much less was paid.
    if (m.kind === 'returned') f.paid -= Number(m.amount_paise);
    else f[m.kind === 'payment' ? 'paid' : m.kind] += Number(m.amount_paise);
  }
  f.net = f.salary - f.pf - f.advance - f.deduction;
  return f;
}

export interface SalaryMonth extends SalaryFigures {
  month: string;
  /** The opening balance counted in this month (in `before`), or 0. */
  opening: Paise;
  /** What the months before left, with any opening balance: above zero still to pay, below zero paid extra. */
  before: Paise;
  /** What this month leaves: above zero still to pay, below zero paid extra and cut from the next salary. */
  balance: Paise;
}

const monthEnd = (month: string) => `${month}-${String(daysInMonth(`${month}-01`)).padStart(2, '0')}`;

/** Month by month from the first (or the opening balance's month), each carrying what the one before left, so extra paid comes off the next salary. */
export function salaryLedger(p: SalaryPerson): SalaryMonth[] {
  const open = p.opening ? { month: p.opening.month.slice(0, 7), paise: Number(p.opening.amount_paise) } : null;
  const first = open && open.month < p.from.slice(0, 7) ? open.month : p.from.slice(0, 7);
  const last = open && monthEnd(open.month) > p.to ? monthEnd(open.month) : p.to;
  let balance = 0;
  return monthParts(`${first}-01`, last).map(([a]) => {
    const month = a.slice(0, 7);
    const f = salaryFigures(p, a, monthEnd(month));
    const opening = month === open?.month ? open.paise : 0;
    const before = balance + opening;
    balance = roundOffSmall(before + f.net - f.paid);
    return { ...f, month, opening, before, balance };
  });
}

/** From–to on the Salary sheet, with what the days before left (an opening balance included) and what is left after. */
export function salaryRow(p: SalaryPerson, from: string, to: string): SalaryFigures & { before: Paise; balance: Paise } {
  const startOfMonth = `${from.slice(0, 7)}-01`;
  const ledger = salaryLedger(p);
  const earlier = ledger.find((m) => m.month === from.slice(0, 7))?.before
    ?? ledger.filter((m) => m.month < from.slice(0, 7)).at(-1)?.balance ?? 0;
  const dayBefore = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const part = from > startOfMonth ? salaryFigures(p, startOfMonth, dayBefore) : null;
  const before = roundOffSmall(earlier + (part ? part.net - part.paid : 0));
  const f = salaryFigures(p, from, to);
  return { ...f, before, balance: roundOffSmall(before + f.net - f.paid) };
}
