import { describe, expect, it } from 'vitest';
import {
  accountChoices, accountScope, allowedFirms, firmErrors, inScope, isCommonEntry, pickWorkingFirm, type AccountRow,
} from '@/lib/firm';
import { cashTransfer, siteCashExpense } from '@/lib/ledger/posting/cash';
import { vendorPayment } from '@/lib/ledger/posting/vendor';
import type { EntryDraft } from '@/lib/ledger/types';
import { getEntryForm } from '@/lib/masters/registry';
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

  it('reads the scope from the field source', () => {
    expect(accountScope('moneyAccounts')).toBe('own');
    expect(accountScope('firmAccounts')).toBe('firm');
    expect(accountScope('vendors')).toBeUndefined();
  });

  it('lists the firm’s own banks and common cash for owner money and site spending', () => {
    expect(accountChoices(rows, 'own', AB)).toEqual([
      { value: AB_BANK.id, label: 'AB Infra - Bank' },
      { value: OWNER_CASH.id, label: 'Owner cash' },
    ]);
  });

  it('lists only the firm’s own banks for payments and receipts: never common cash or another firm’s', () => {
    expect(accountChoices(rows, 'firm', AB)).toEqual([{ value: AB_BANK.id, label: 'AB Infra - Bank' }]);
  });

  it('checks a chosen account the same way on save', () => {
    expect(inScope('own', null, AB)).toBe(true);
    expect(inScope('own', AB, AB)).toBe(true);
    expect(inScope('own', JI, AB)).toBe(false);
    expect(inScope('firm', null, AB)).toBe(false);
    expect(inScope('firm', AB, AB)).toBe(true);
    expect(inScope('firm', JI, AB)).toBe(false);
  });
});

describe('firmErrors (checked on save)', () => {
  const fields = (slug: string) => getEntryForm(slug)!.fields;

  it('saves for the firm the form was opened in, even after a switch to the other firm', () => {
    // Opened in AB Infra, saved after switching to Jayraj: AB is still a firm this person may use.
    expect(firmErrors('vendor-bill', fields('vendor-bill'), AB, [AB, JI], {})).toBeNull();
  });

  it('refuses a firm the person may not use, or no firm on a firm’s form', () => {
    expect(firmErrors('vendor-bill', fields('vendor-bill'), JI, [AB], {})).toEqual({ _form: 'not_allowed' });
    expect(firmErrors('vendor-bill', fields('vendor-bill'), null, [AB], {})).toEqual({ _form: 'not_allowed' });
  });

  it('lets supervisors post without a firm, but not a firm’s form', () => {
    expect(firmErrors('site-spend', fields('site-spend'), null, null, {})).toBeNull();
    expect(firmErrors('vendor-bill', fields('vendor-bill'), null, null, {})).toEqual({ _form: 'not_allowed' });
    expect(firmErrors('site-spend', fields('site-spend'), AB, null, {})).toEqual({ _form: 'not_allowed' });
  });

  it('refuses the other firm’s work order', () => {
    expect(firmErrors('client-bill', fields('client-bill'), AB, [AB, JI], { work_order_id: JI })).toEqual({ work_order_id: 'other_firm' });
    expect(firmErrors('client-bill', fields('client-bill'), JI, [AB, JI], { work_order_id: JI })).toBeNull();
  });

  it('never lets a payment or receipt use another firm’s account, and site spending uses only its own', () => {
    expect(firmErrors('pay-vendor', fields('pay-vendor'), AB, [AB, JI], { from_account_id: JI })).toEqual({ from_account_id: 'other_firm' });
    expect(firmErrors('pay-vendor', fields('pay-vendor'), AB, [AB, JI], { from_account_id: AB })).toBeNull();
    expect(firmErrors('site-spend', fields('site-spend'), AB, [AB, JI], { from_account_id: JI })).toEqual({ from_account_id: 'other_firm' });
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

  it('is false for a firm’s bill paid from the firm’s own cash', () => {
    const payment = vendorPayment({
      billFirmId: AB, vendorId: VENDOR, from: { id: 'acct-ab-cash', kind: 'owner_cash', firmId: AB }, amountPaise: 100_000, paymentDate: '2026-10-22',
    });
    expect(payment.firmId).toBe(AB);
    expect(isCommonEntry(rowsOf(payment))).toBe(false);
  });
});
