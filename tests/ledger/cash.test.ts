import { describe, expect, it } from 'vitest';
import {
  cashCloseDifference,
  cashTransfer,
  ownerCapital,
  ownerDrawing,
  siteCashExpense,
} from '@/lib/ledger/posting/cash';
import { withBankCharges } from '@/lib/ledger/posting/other';
import { AB_BANK, JI, JI_BANK, OWNER_CASH, RAMESH, SVG } from './fixtures';

describe('siteCashExpense', () => {
  it('records a supervisor site expense as a site cost of the cash account’s firm (spec example: ₹5,460 labour)', () => {
    const draft = siteCashExpense({
      from: RAMESH, siteId: SVG, costHead: 'labour', amountPaise: 546_000, expenseDate: '2026-10-18', narration: '13 helpers',
    });
    expect(draft.firmId).toBe(JI);
    expect(draft.lines).toEqual([
      { account: 'site_cost', amountPaise: 546_000, firmId: JI, siteId: SVG, costHead: 'labour' },
      { account: 'money', amountPaise: -546_000, firmId: JI, moneyAccountId: RAMESH.id },
    ]);
  });

  it('requires a note', () => {
    expect(() =>
      siteCashExpense({ from: RAMESH, siteId: SVG, costHead: 'other', amountPaise: 100, expenseDate: '2026-10-18', narration: ' ' }),
    ).toThrow('say what the money was spent on');
  });
});

describe('cashTransfer', () => {
  it('moves money between accounts of one firm, and refuses a move between firms', () => {
    const toSupervisor = cashTransfer({ from: OWNER_CASH, to: RAMESH, amountPaise: 2_000_000, transferDate: '2026-10-22' });
    expect(toSupervisor.lines).toEqual([
      { account: 'money', amountPaise: 2_000_000, firmId: JI, moneyAccountId: RAMESH.id },
      { account: 'money', amountPaise: -2_000_000, firmId: JI, moneyAccountId: OWNER_CASH.id },
    ]);
    expect(() => cashTransfer({ from: JI_BANK, to: AB_BANK, amountPaise: 300, transferDate: '2026-10-22' })).toThrow('between firms');
  });

  it('refuses a transfer to the same account', () => {
    expect(() => cashTransfer({ from: RAMESH, to: RAMESH, amountPaise: 1, transferDate: '2026-10-22' })).toThrow(
      'same account',
    );
  });
});

describe('cashCloseDifference', () => {
  it('records a shortage when counted cash is less than expected', () => {
    const draft = cashCloseDifference({ account: RAMESH, expectedPaise: 870_000, countedPaise: 750_000, closeDate: '2026-10-21' });
    expect(draft.narration).toBe('Cash short at day close');
    expect(draft.lines).toEqual([
      { account: 'money', amountPaise: -120_000, firmId: JI, moneyAccountId: RAMESH.id },
      { account: 'cash_short_excess', amountPaise: 120_000, firmId: JI },
    ]);
  });

  it('records an excess and refuses when nothing differs', () => {
    const excess = cashCloseDifference({ account: RAMESH, expectedPaise: 100, countedPaise: 150, closeDate: '2026-10-21' });
    expect(excess.narration).toBe('Cash excess at day close');
    expect(excess.lines[0]).toMatchObject({ account: 'money', amountPaise: 50 });
    expect(() => cashCloseDifference({ account: RAMESH, expectedPaise: 5, countedPaise: 5, closeDate: '2026-10-21' })).toThrow(
      'nothing to record',
    );
  });
});

describe('owner money', () => {
  it('keeps owner capital and drawings out of site costs', () => {
    expect(ownerCapital({ account: OWNER_CASH, amountPaise: 100, date: '2026-10-22' }).lines).toEqual([
      { account: 'money', amountPaise: 100, firmId: JI, moneyAccountId: OWNER_CASH.id },
      { account: 'owner_capital', amountPaise: -100, firmId: JI },
    ]);
    expect(ownerDrawing({ account: OWNER_CASH, amountPaise: 100, date: '2026-10-22' }).lines).toEqual([
      { account: 'owner_capital', amountPaise: 100, firmId: JI },
      { account: 'money', amountPaise: -100, firmId: JI, moneyAccountId: OWNER_CASH.id },
    ]);
  });
});

describe('withBankCharges', () => {
  it('takes the charges with the money from the bank, as the firm’s bank charges, and only from a bank in the entry', () => {
    const draft = cashTransfer({ from: JI_BANK, to: OWNER_CASH, amountPaise: 10_000_00, transferDate: '2026-11-05' });
    const charged = withBankCharges(draft, JI_BANK, 10_00);
    expect(charged.lines).toEqual([
      ...draft.lines.map((l) => (l.moneyAccountId === JI_BANK.id ? { ...l, amountPaise: -10_010_00 } : l)),
      { account: 'firm_cost', amountPaise: 10_00, firmId: JI_BANK.firmId, costHead: 'bank_charges' },
    ]);
    expect(withBankCharges(draft, JI_BANK, 0)).toBe(draft);
    expect(() => withBankCharges(draft, OWNER_CASH, 10_00)).toThrow('charges_bank');
  });
});
