import { percentOf, type Paise } from '@/lib/money';
import { daysInMonth, staffSalary, type PersonKind } from '@/lib/wages';

export interface LabourRate { from_month: string; rate_paise: number | string }
export interface LabourSettings {
  from_month: string;
  pf_bp: number;
  pf_ceiling_paise: number | string;
  esic_bp: number;
  esic_limit_paise: number | string;
  ot_percent: number;
}
export interface LabourPerson {
  kind: PersonKind;
  joined_on: string;
  left_on: string | null;
  pf_on: boolean;
  esic_on: boolean;
}
export interface MonthDays { month: string; present: number; absent: number; ot_hours: number | string }
export type MoneyKind = 'advance' | 'payment' | 'deduction';
export interface LabourMoney { id: string; money_date: string; kind: MoneyKind; amount_paise: number | string; method?: string | null; reference?: string; note?: string; created_by?: string; created_at?: string }

/** What counts for a month: the latest kept from that month or before, else the earliest, so nobody is paid ₹0 by mistake. */
function inForce<T extends { from_month: string }>(rows: T[], month: string): T | undefined {
  const sorted = [...rows].sort((a, b) => a.from_month.localeCompare(b.from_month));
  return sorted.filter((r) => r.from_month.slice(0, 7) <= month).at(-1) ?? sorted[0];
}

const nearestRupee = (paise: number) => Math.round(paise / 100) * 100;
const upToRupee = (paise: number) => Math.ceil(paise / 100) * 100;

export interface MonthPay {
  month: string;
  present: number;
  absent: number;
  otHours: number;
  rate: Paise;
  dayPaise: Paise;
  otPaise: Paise;
  earned: Paise;
  pf: Paise;
  esic: Paise;
  net: Paise;
}

/**
 * One person's pay for a month, up to `today` in the running month. Worker: days present × the day's rate, plus OT at
 * the day's rate ÷ 8 × the OT percent. Staff: the fixed salary, by calendar days only for a part month.
 * PF is on pay for days worked up to the ceiling, ESIC on full pay for someone earning up to the limit.
 */
export function monthPay(person: LabourPerson, rates: LabourRate[], allSettings: LabourSettings[], days: Omit<MonthDays, 'month'>, month: string, today: string): MonthPay {
  const rate = Number(inForce(rates, month)?.rate_paise ?? 0);
  const settings = inForce(allSettings, month)!;
  const otHours = Number(days.ot_hours);
  let dayPaise = days.present * rate;
  let otPaise = Math.round((Math.round(otHours * 100) * rate * settings.ot_percent) / 80_000);
  if (person.kind === 'staff') {
    const first = `${month}-01`;
    const last = `${month}-${String(daysInMonth(first)).padStart(2, '0')}`;
    const from = person.joined_on > first ? person.joined_on : first;
    const to = [last, today, person.left_on ?? last].sort()[0]!;
    dayPaise = from <= to ? staffSalary(rate, from, to) : 0;
    otPaise = 0;
  }
  const earned = dayPaise + otPaise;
  const pf = person.pf_on ? nearestRupee(percentOf(Math.min(dayPaise, Number(settings.pf_ceiling_paise)), settings.pf_bp)) : 0;
  // Staff go by the month's salary: a ₹30,000 salary is above the limit even when only ₹5,000 has built up so far.
  const esicPay = person.kind === 'staff' ? rate : earned;
  const esic = person.esic_on && earned > 0 && esicPay <= Number(settings.esic_limit_paise) ? upToRupee(percentOf(earned, settings.esic_bp)) : 0;
  return { month, present: days.present, absent: days.absent, otHours, rate, dayPaise, otPaise, earned, pf, esic, net: earned - pf - esic };
}

/** "2026-10" to "2026-12" as ["2026-10", "2026-11", "2026-12"]. */
function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let [y, m] = from.split('-').map(Number) as [number, number]; `${y}-${String(m).padStart(2, '0')}` <= to; m === 12 ? (y++, m = 1) : m++) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return months;
}

export type LedgerRow =
  | { type: 'salary'; date: string; pay: MonthPay; balance: Paise }
  | { type: MoneyKind; date: string; money: LabourMoney; balance: Paise };

export interface LabourLedger {
  rows: LedgerRow[];
  months: MonthPay[];
  earned: Paise;
  pf: Paise;
  esic: Paise;
  otherCuts: Paise;
  advances: Paise;
  paid: Paise;
  /** Above zero we still have to pay; below zero we paid extra. */
  balance: Paise;
}

/**
 * A person's running account: each month's salary and every money line in date order, with what is left after each.
 * Workers count the months that have attendance; staff every month from joining to leaving or today.
 */
export function labourLedger(person: LabourPerson, rates: LabourRate[], settings: LabourSettings[], days: MonthDays[], money: LabourMoney[], today: string): LabourLedger {
  const byMonth = new Map(days.map((d) => [d.month, d]));
  const thisMonth = today.slice(0, 7);
  const staffEnd = person.left_on && person.left_on < today ? person.left_on.slice(0, 7) : thisMonth;
  const staffMonths = person.kind === 'staff' ? monthsBetween(person.joined_on.slice(0, 7), staffEnd) : [];
  const allMonths = [...new Set([...days.map((d) => d.month), ...staffMonths])].sort();
  const months = allMonths.map((m) => monthPay(person, rates, settings, byMonth.get(m) ?? { present: 0, absent: 0, ot_hours: 0 }, m, today));

  type Dated = { date: string; order: number; row: LedgerRow };
  const dated: Dated[] = [
    ...months.map((pay): Dated => {
      const end = `${pay.month}-${String(daysInMonth(`${pay.month}-01`)).padStart(2, '0')}`;
      return { date: end < today ? end : today, order: 0, row: { type: 'salary', date: end < today ? end : today, pay, balance: 0 } };
    }),
    ...money.map((m): Dated => ({ date: m.money_date, order: 1, row: { type: m.kind, date: m.money_date, money: m, balance: 0 } })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  let balance = 0;
  const rows = dated.map(({ row }) => {
    balance += row.type === 'salary' ? row.pay.net : -Number(row.money.amount_paise);
    return { ...row, balance };
  });
  const sumPay = (key: 'earned' | 'pf' | 'esic') => months.reduce((s, p) => s + p[key], 0);
  const sumMoney = (kind: MoneyKind) => money.filter((m) => m.kind === kind).reduce((s, m) => s + Number(m.amount_paise), 0);
  return {
    rows, months, earned: sumPay('earned'), pf: sumPay('pf'), esic: sumPay('esic'),
    otherCuts: sumMoney('deduction'), advances: sumMoney('advance'), paid: sumMoney('payment'), balance,
  };
}
