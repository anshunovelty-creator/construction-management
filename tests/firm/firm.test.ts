import { describe, expect, it } from 'vitest';
import {
  accountChoices, allowedFirms, firmErrors, firmsForSave, isCommonEntry, pickWorkingFirm,
  type AccountRow,
} from '@/lib/firm';
import { cashTransfer } from '@/lib/ledger/posting/cash';
import { vendorPayment } from '@/lib/ledger/posting/vendor';
import type { EntryDraft } from '@/lib/ledger/types';
import { getEntryForm } from '@/lib/masters/registry';
import { AB, AB_BANK, JI, JI_BANK, OWNER_CASH, RAMESH, VENDOR } from '../ledger/fixtures';

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
    { id: AB_BANK.id, name: 'AB Infra - Bank', firm_id: AB, kind: 'bank' },
    { id: JI_BANK.id, name: 'Jayraj Infra - Bank', firm_id: JI, kind: 'bank' },
    { id: OWNER_CASH.id, name: 'Owner cash', firm_id: null, kind: 'owner_cash' },
  ];

  it('lists only the firm’s own accounts: never another firm’s, nor cash left from when it was shared', () => {
    expect(accountChoices(rows, AB)).toEqual([{ value: AB_BANK.id, label: 'AB Infra - Bank', kind: 'bank' }]);
  });
});

describe('firmsForSave', () => {
  const working = { firms: [ab, ji], firm: ab };

  it('lets supervisors post without a firm', () => {
    expect(firmsForSave('supervisor', null)).toBeNull();
  });

  it('gives the owner and office staff the firms they may use', () => {
    expect(firmsForSave('owner', working)).toEqual([AB, JI]);
    expect(firmsForSave('office', { firms: [ji] })).toEqual([JI]);
  });

  it('gives office staff with no firm assigned none, so nothing they save gets through', () => {
    expect(firmsForSave('office', null)).toEqual([]);
    expect(firmsForSave('labour', null)).toEqual([]);
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

  it('refuses office staff with no firm, even on a form supervisors may post without one', () => {
    expect(firmErrors('site-spend', fields('site-spend'), null, [], {})).toEqual({ _form: 'not_allowed' });
    expect(firmErrors('vendor-bill', fields('vendor-bill'), null, [], {})).toEqual({ _form: 'not_allowed' });
  });

  it('refuses a client receipt into the other firm’s account', () => {
    expect(firmErrors('client-receipt', fields('client-receipt'), AB, [AB, JI], { to_account_id: JI })).toEqual({ to_account_id: 'other_firm' });
    expect(firmErrors('client-receipt', fields('client-receipt'), JI, [AB, JI], { to_account_id: JI })).toBeNull();
  });

  it('never lets a payment or receipt use another firm’s account, and site spending uses only its own', () => {
    expect(firmErrors('pay-vendor', fields('pay-vendor'), AB, [AB, JI], { from_account_id: JI })).toEqual({ from_account_id: 'other_firm' });
    expect(firmErrors('pay-vendor', fields('pay-vendor'), AB, [AB, JI], { from_account_id: AB })).toBeNull();
    expect(firmErrors('site-spend', fields('site-spend'), AB, [AB, JI], { from_account_id: JI })).toEqual({ from_account_id: 'other_firm' });
  });
});

describe('isCommonEntry', () => {
  const rowsOf = (draft: EntryDraft) => draft.lines.map((l) => ({ firm_id: l.firmId ?? null }));

  it('is true only for an old entry with no firm on any line', () => {
    expect(isCommonEntry([{ firm_id: null }, { firm_id: null }])).toBe(true);
    expect(isCommonEntry(rowsOf(cashTransfer({ from: OWNER_CASH, to: RAMESH, amountPaise: 500_000, transferDate: '2026-10-22' })))).toBe(false);
  });

  it('is false for a firm’s bill paid from the firm’s own cash', () => {
    const payment = vendorPayment({
      billFirmId: AB, vendorId: VENDOR, from: { id: 'acct-ab-cash', kind: 'owner_cash', firmId: AB }, amountPaise: 100_000, paymentDate: '2026-10-22',
    });
    expect(payment.firmId).toBe(AB);
    expect(isCommonEntry(rowsOf(payment))).toBe(false);
  });
});
