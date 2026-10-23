import { describe, expect, it } from 'vitest';
import { openingClientBalance, openingMoneyBalance, openingVendorBalance } from '@/lib/ledger/posting/opening';
import { CLIENT, JI, JI_BANK, SVG, VENDOR, WO } from './fixtures';

describe('opening balances', () => {
  it('records what a firm owes a vendor on the opening date', () => {
    const draft = openingVendorBalance({ firmId: JI, vendorId: VENDOR, amountPaise: 133_019_300, asOf: '2026-10-21' });
    expect(draft).toMatchObject({ entryType: 'opening', entryDate: '2026-10-21', firmId: JI, partyId: VENDOR });
    expect(draft.lines).toEqual([
      { account: 'opening_balance', amountPaise: 133_019_300 },
      { account: 'vendor_payable', amountPaise: -133_019_300, firmId: JI, partyId: VENDOR },
    ]);
  });

  it('records opening bank/cash and client balances', () => {
    expect(openingMoneyBalance({ account: JI_BANK, amountPaise: 62_000_000, asOf: '2026-10-21' }).lines).toEqual([
      { account: 'money', amountPaise: 62_000_000, firmId: JI, moneyAccountId: JI_BANK.id },
      { account: 'opening_balance', amountPaise: -62_000_000 },
    ]);
    expect(openingClientBalance({ workOrder: WO, amountPaise: -1_000, asOf: '2026-10-21' }).lines).toEqual([
      { account: 'client_receivable', amountPaise: -1_000, firmId: JI, partyId: CLIENT, siteId: SVG, workOrderId: WO.id },
      { account: 'opening_balance', amountPaise: 1_000 },
    ]);
  });

  it('refuses a zero opening balance', () => {
    expect(() => openingVendorBalance({ firmId: JI, vendorId: VENDOR, amountPaise: 0, asOf: '2026-10-21' })).toThrow(
      'cannot be zero',
    );
  });
});
