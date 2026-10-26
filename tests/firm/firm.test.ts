import { describe, expect, it } from 'vitest';
import { accountChoices, accountScope, allowedFirms, inScope, isCommonEntry, pickWorkingFirm, type AccountRow } from '@/lib/firm';
import { cashTransfer, siteCashExpense } from '@/lib/ledger/posting/cash';
import { vendorPayment } from '@/lib/ledger/posting/vendor';
import type { EntryDraft } from '@/lib/ledger/types';
import { AB, AB_BANK, JI, JI_BANK, OWNER_CASH, RAMESH, SVG, VENDOR } from '../ledger/fixtures';

const ab = { id: AB, name: 'AB Infra' };
const ji = { id: JI, name: 'Jayraj Infra' };

describe('allowedFirms', () => {
  it('gives the owner every firm, office staff their assigned ones and supervisors none', () => {
    expect(allowedFirms('owner', [ab, ji], [])).toEqual([ab, ji]);
    expect(allowedFirms('office', [ab, ji], [JI])).toEqual([ji]);
    expect(allowedFirms('office', [ab, ji], [])).toEqual([]);
    expect(allowedFirms('supervisor', [ab, ji], [AB])).toEqual([]);
  });
});

describe('pickWorkingFirm', () => {
  it('uses the saved firm while it is allowed', () => {
    expect(pickWorkingFirm([ab, ji], JI)).toEqual(ji);
  });

  it('falls back to the first allowed firm when nothing is saved or the saved one was taken away', () => {
    expect(pickWorkingFirm([ab, ji], null)).toEqual(ab);
    expect(pickWorkingFirm([ji], AB)).toEqual(ji);
    expect(pickWorkingFirm([], AB)).toBeUndefined();
  });
});

describe('money account lists', () => {
  const rows: AccountRow[] = [
    { id: AB_BANK.id, name: 'AB Infra - Bank', firm_id: AB },
    { id: JI_BANK.id, name: 'Jayraj Infra - Bank', firm_id: JI },
    { id: OWNER_CASH.id, name: 'Owner cash', firm_id: null },
  ];
  const groupOf = (otherFirmId: string) => `Other firm: ${otherFirmId}`;

  it('reads the scope from the field source', () => {
    expect(accountScope('moneyAccounts')).toBe('own');
    expect(accountScope('moneyAccountsWeOwe')).toBe('weOwe');
    expect(accountScope('moneyAccountsTheyOwe')).toBe('theyOwe');
    expect(accountScope('vendors')).toBeUndefined();
  });

  it('lists only the firm’s own banks and common cash where money may not cross', () => {
    expect(accountChoices(rows, 'own', AB, groupOf)).toEqual([
      { value: AB_BANK.id, label: 'AB Infra - Bank' },
      { value: OWNER_CASH.id, label: 'Owner cash' },
    ]);
  });

  it('adds the other firm’s banks last, in their own group, where money may cross', () => {
    expect(accountChoices(rows, 'weOwe', AB, groupOf)).toEqual([
      { value: AB_BANK.id, label: 'AB Infra - Bank' },
      { value: OWNER_CASH.id, label: 'Owner cash' },
      { value: JI_BANK.id, label: 'Jayraj Infra - Bank', group: `Other firm: ${JI}` },
    ]);
  });

  it('checks a chosen account the same way on save', () => {
    expect(inScope('own', null, AB)).toBe(true);
    expect(inScope('own', AB, AB)).toBe(true);
    expect(inScope('own', JI, AB)).toBe(false);
    expect(inScope('weOwe', JI, AB)).toBe(true);
    expect(inScope('theyOwe', JI, AB)).toBe(true);
  });
});

describe('isCommonEntry', () => {
  const rowsOf = (draft: EntryDraft) => draft.lines.map((l) => ({ firm_id: l.firmId ?? null }));

  it('is true when no line names a firm, like cash handed to a supervisor or a supervisor’s spend', () => {
    const handOver = cashTransfer({ from: OWNER_CASH, to: RAMESH, amountPaise: 500_000, transferDate: '2026-10-22' });
    const spend = siteCashExpense({
      from: RAMESH, siteId: SVG, costHead: 'labour', amountPaise: 50_000, expenseDate: '2026-10-22', narration: 'helpers',
    });
    expect(isCommonEntry(rowsOf(handOver))).toBe(true);
    expect(isCommonEntry(rowsOf(spend))).toBe(true);
  });

  it('is false for a firm’s bill paid from owner cash, though its serial is CM', () => {
    const payment = vendorPayment({ billFirmId: AB, vendorId: VENDOR, from: OWNER_CASH, amountPaise: 100_000, paymentDate: '2026-10-22' });
    expect(payment.firmId).toBeNull();
    expect(isCommonEntry(rowsOf(payment))).toBe(false);
  });
});
