import { describe, expect, it } from 'vitest';
import { assertBalanced, assertDate, assertPositive } from '@/lib/ledger/balance';
import { interFirmLines } from '@/lib/ledger/inter-firm';
import type { EntryDraft } from '@/lib/ledger/types';
import { AB, JI } from './fixtures';

const base: EntryDraft = { id: 'x', entryType: 'cash_transfer', entryDate: '2026-10-22', firmId: null, lines: [] };

describe('assertBalanced', () => {
  it('accepts lines that sum to zero', () => {
    expect(() =>
      assertBalanced({
        ...base,
        lines: [
          { account: 'money', amountPaise: 5, moneyAccountId: 'a' },
          { account: 'money', amountPaise: -5, moneyAccountId: 'b' },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects single-line, unbalanced and zero-amount drafts', () => {
    expect(() => assertBalanced({ ...base, lines: [{ account: 'money', amountPaise: 5, moneyAccountId: 'a' }] })).toThrow(
      'at least two lines',
    );
    expect(() =>
      assertBalanced({
        ...base,
        lines: [
          { account: 'money', amountPaise: 5, moneyAccountId: 'a' },
          { account: 'money', amountPaise: -4, moneyAccountId: 'b' },
        ],
      }),
    ).toThrow('does not balance');
    expect(() =>
      assertBalanced({
        ...base,
        lines: [
          { account: 'money', amountPaise: 0, moneyAccountId: 'a' },
          { account: 'money', amountPaise: 0, moneyAccountId: 'b' },
        ],
      }),
    ).toThrow('zero amount');
  });
});

describe('assertDate and assertPositive', () => {
  it('accepts only real YYYY-MM-DD calendar dates', () => {
    expect(() => assertDate('2026-10-22', 'date')).not.toThrow();
    expect(() => assertDate('2026-02-30', 'date')).toThrow('must be a date');
    expect(() => assertDate('22-10-2026', 'date')).toThrow('must be a date');
  });

  it('accepts only positive whole paise', () => {
    expect(() => assertPositive(1, 'amount')).not.toThrow();
    expect(() => assertPositive(0, 'amount')).toThrow('must be more than zero');
    expect(() => assertPositive(1.5, 'amount')).toThrow('whole number of paise');
  });
});

describe('interFirmLines', () => {
  it('makes the debtor firm owe the creditor firm', () => {
    expect(interFirmLines(JI, AB, 200)).toEqual([
      { account: 'inter_firm', amountPaise: 200, firmId: JI, counterFirmId: AB },
      { account: 'inter_firm', amountPaise: -200, firmId: AB, counterFirmId: JI },
    ]);
  });

  it('adds nothing for the same firm or for common cash', () => {
    expect(interFirmLines(JI, JI, 200)).toEqual([]);
    expect(interFirmLines(null, AB, 200)).toEqual([]);
    expect(interFirmLines(JI, null, 200)).toEqual([]);
  });
});
