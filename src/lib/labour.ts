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

/** A person's months in order, each carrying what the one before left, so extra paid comes off the next salary. */
export function labourLedger(months: LabourMonth[], rates: LabourRate[]): LedgerMonth[] {
  let balance = 0;
  return [...months].sort((a, b) => a.month.localeCompare(b.month)).map((m) => {
    const month = m.month.slice(0, 7);
    const rate = rateFor(rates, month);
    const salary = salaryFor(m.present_days, m.ot_hours, rate);
    const [addition, deduction, advance, paid] = [m.addition_paise, m.deduction_paise, m.advance_paise, m.paid_paise].map(Number) as [Paise, Paise, Paise, Paise];
    const net = salary + addition - deduction - advance;
    const before = balance;
    balance = roundOffSmall(before + net - paid);
    return { month, days: Number(m.present_days), otHours: Number(m.ot_hours), rate, salary, addition, deduction, advance, net, before, paid, balance, note: m.note ?? '' };
  });
}
