import { roundOffSmall, type Paise } from '@/lib/money';

export interface LabourRate { from_month: string; rate_paise: number | string }

/** What is typed for one person and month. `month` is the first of the month, as the database keeps it. */
export interface LabourMonth {
  month: string;
  present_days: number | string;
  ot_hours: number | string;
  advance_paise: number | string;
  deduction_paise: number | string;
  addition_paise: number | string;
  paid_paise: number | string;
  note?: string;
}

/** The day's salary for a month ("2026-10"): the latest kept from that month or before, else the earliest. */
export function rateFor(rates: LabourRate[], month: string): Paise {
  const sorted = [...rates].sort((a, b) => a.from_month.localeCompare(b.from_month));
  return Number((sorted.filter((r) => r.from_month.slice(0, 7) <= month).at(-1) ?? sorted[0])?.rate_paise ?? 0);
}

/** Days × the day's salary, plus OT hours at the day's salary ÷ 8. Whole numbers until the last step, to the paisa. */
export function salaryFor(days: number | string, otHours: number | string, rate: Paise): Paise {
  return Math.round((Math.round(Number(days) * 100) * rate) / 100 + (Math.round(Number(otHours) * 100) * rate) / 800);
}

export interface LedgerMonth {
  month: string;
  days: number;
  otHours: number;
  rate: Paise;
  /** Days and OT, before anything is taken off. */
  salary: Paise;
  addition: Paise;
  deduction: Paise;
  advance: Paise;
  /** The month's salary with the addition, deduction and advance counted. */
  net: Paise;
  /** What the months before left: above zero still to pay, below zero paid extra. */
  before: Paise;
  paid: Paise;
  /** What this month leaves: above zero still to pay, below zero paid extra and cut from the next salary. */
  balance: Paise;
  note: string;
}

type MonthFigures = Omit<LedgerMonth, 'net' | 'before' | 'balance'>;

/** Months in order, each carrying what the one before left, so extra paid comes off the next salary. */
function carry(months: MonthFigures[]): LedgerMonth[] {
  let balance = 0;
  return [...months].sort((a, b) => a.month.localeCompare(b.month)).map((m) => {
    const net = m.salary + m.addition - m.deduction - m.advance;
    const before = balance;
    balance = roundOffSmall(before + net - m.paid);
    return { ...m, net, before, balance };
  });
}

function figures(m: LabourMonth, rates: LabourRate[]): MonthFigures {
  const month = m.month.slice(0, 7);
  const rate = rateFor(rates, month);
  const [addition, deduction, advance, paid] = [m.addition_paise, m.deduction_paise, m.advance_paise, m.paid_paise].map(Number) as [Paise, Paise, Paise, Paise];
  return {
    month, days: Number(m.present_days), otHours: Number(m.ot_hours), rate,
    salary: salaryFor(m.present_days, m.ot_hours, rate), addition, deduction, advance, paid, note: m.note ?? '',
  };
}

/** A person's months in order, each carrying what the one before left, so extra paid comes off the next salary. */
export function labourLedger(months: LabourMonth[], rates: LabourRate[]): LedgerMonth[] {
  return carry(months.map((m) => figures(m, rates)));
}

/** Money given to a family's head (or taken off), kept with its date. */
export interface LabourMoney {
  money_date: string;
  kind: 'advance' | 'payment' | 'deduction';
  amount_paise: number | string;
}

/**
 * A family's ledger: every member's days at their own day salary, added up per month, with the money given to the head
 * counted in the month of its date. It carries like one person's. `rate` is 0, as members' salaries differ.
 */
export function familyLedger(members: { months: LabourMonth[]; rates: LabourRate[] }[], money: LabourMoney[]): LedgerMonth[] {
  const byMonth = new Map<string, MonthFigures>();
  const at = (month: string) => byMonth.get(month)
    ?? byMonth.set(month, { month, days: 0, otHours: 0, rate: 0, salary: 0, addition: 0, deduction: 0, advance: 0, paid: 0, note: '' }).get(month)!;
  for (const member of members) {
    for (const f of member.months.map((m) => figures(m, member.rates))) {
      const m = at(f.month);
      m.days = Math.round((m.days + f.days) * 100) / 100;
      m.otHours = Math.round((m.otHours + f.otHours) * 100) / 100;
      m.salary += f.salary;
      m.addition += f.addition;
      m.deduction += f.deduction;
      m.advance += f.advance;
      m.paid += f.paid;
    }
  }
  for (const line of money) {
    const m = at(line.money_date.slice(0, 7));
    const key = line.kind === 'payment' ? 'paid' : line.kind;
    m[key] += Number(line.amount_paise);
  }
  return carry([...byMonth.values()]);
}

export interface RateRow { worker_id: string; from_month: string; rate_paise: number }

/**
 * The salary rows to save for day salaries changed from a month ("2026-11-01"), so that months before it keep theirs.
 * A month with no salary counting from before it borrows the earliest one; when that earliest one is the one changed,
 * it is kept from the month before, and earlier months stay as they were.
 */
export function ratesToSave(have: RateRow[], changes: RateRow[]): RateRow[] {
  const keep = changes.flatMap((c) => {
    const mine = have.filter((h) => h.worker_id === c.worker_id).sort((a, b) => a.from_month.localeCompare(b.from_month));
    if (mine.length === 0 || mine[0]!.from_month < c.from_month) return [];
    const before = new Date(`${c.from_month}T00:00:00Z`);
    before.setUTCMonth(before.getUTCMonth() - 1);
    return [{ worker_id: c.worker_id, from_month: before.toISOString().slice(0, 10), rate_paise: Number(mine[0]!.rate_paise) }];
  });
  return [...keep, ...changes];
}
