import { assertPaise } from '@/lib/money';
import type { EntryDraft } from './types';

/** Same rules the database enforces, checked early so the user gets a clear message. */
export function assertBalanced(draft: EntryDraft): void {
  if (draft.lines.length < 2) {
    throw new Error('an entry needs at least two lines');
  }
  let sum = 0;
  for (const line of draft.lines) {
    assertPaise(line.amountPaise, `${line.account} line`);
    if (line.amountPaise === 0) {
      throw new Error(`${line.account} line has a zero amount`);
    }
    sum += line.amountPaise;
  }
  if (sum !== 0) {
    throw new Error(`entry does not balance: lines sum to ${sum} paise`);
  }
}

/** Throws unless the amount is a positive whole number of paise. */
export function assertPositive(amount: number, label: string): void {
  assertPaise(amount, label);
  if (amount <= 0) {
    throw new Error(`${label} must be more than zero`);
  }
}

/** Throws unless the value is a YYYY-MM-DD calendar date. */
export function assertDate(value: string, label: string): void {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a date like 2026-10-22, got "${value}"`);
  }
}
