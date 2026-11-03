import type { Paise } from '@/lib/money';

/** One statement row: debits add to the balance, credits take from it. Dates are YYYY-MM-DD. */
export interface StatementInput {
  date: string;
  debit: Paise;
  credit: Paise;
}

export interface Statement<T extends StatementInput> {
  /** Everything before `from`, as one balance brought forward. */
  opening: Paise;
  lines: (T & { balance: Paise })[];
  debit: Paise;
  credit: Paise;
  closing: Paise;
}

/**
 * A bank-statement view of rows already in date order: rows before `from` fold into the opening balance,
 * rows after `to` are left out, and each row carries the running balance (debit minus credit).
 */
export function buildStatement<T extends StatementInput>(rows: T[], from = '', to = ''): Statement<T> {
  let opening = 0;
  let debit = 0;
  let credit = 0;
  const lines: Statement<T>['lines'] = [];
  for (const row of rows) {
    if (to && row.date > to) continue;
    if (from && row.date < from) {
      opening += row.debit - row.credit;
      continue;
    }
    debit += row.debit;
    credit += row.credit;
    lines.push({ ...row, balance: opening + debit - credit });
  }
  return { opening, lines, debit, credit, closing: opening + debit - credit };
}

/**
 * The foot of a ledger as Tally prints it: the opening balance counts in its own column, the current totals, then the
 * closing balance in the opposite column so that both columns end on the same grand total.
 */
export function tallyFoot(s: Pick<Statement<StatementInput>, 'opening' | 'debit' | 'credit'>) {
  const debit = Math.max(s.opening, 0) + s.debit;
  const credit = Math.max(-s.opening, 0) + s.credit;
  const closing = debit - credit;
  return {
    debit,
    credit,
    /** A debit balance closes on the credit side, and a credit balance on the debit side. */
    closingDebit: Math.max(-closing, 0),
    closingCredit: Math.max(closing, 0),
    total: Math.max(debit, credit),
  };
}
