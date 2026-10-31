import { describe, expect, it } from 'vitest';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import { AB, JI, JI_BANK, OWNER_CASH, SVG, sumOf, VENDOR } from './fixtures';

describe('vendorBill', () => {
  it('charges each item to the site and credits the vendor with the total', () => {
    const draft = vendorBill({
      id: 'bill-1',
      firmId: AB,
      vendorId: VENDOR,
      siteId: SVG,
      billDate: '2026-10-22',
      billNo: ' 4471 ',
      items: [
        { costHead: 'material', amountPaise: 48_300_000 },
        { costHead: 'transport', amountPaise: 1_700_000 },
      ],
    });
    expect(draft).toMatchObject({ id: 'bill-1', entryType: 'vendor_bill', firmId: AB, partyId: VENDOR, reference: '4471' });
    expect(draft.lines).toEqual([
      { account: 'site_cost', amountPaise: 48_300_000, firmId: AB, siteId: SVG, costHead: 'material', partyId: VENDOR },
      { account: 'site_cost', amountPaise: 1_700_000, firmId: AB, siteId: SVG, costHead: 'transport', partyId: VENDOR },
      { account: 'vendor_payable', amountPaise: -50_000_000, firmId: AB, partyId: VENDOR },
    ]);
  });

  it('needs a bill number and positive items', () => {
    const input = { firmId: AB, vendorId: VENDOR, siteId: SVG, billDate: '2026-10-22', billNo: '1', items: [] };
    expect(() => vendorBill(input)).toThrow('at least one item');
    expect(() => vendorBill({ ...input, billNo: ' ', items: [{ costHead: 'material', amountPaise: 1 }] })).toThrow(
      'bill number is required',
    );
    expect(() => vendorBill({ ...input, items: [{ costHead: 'material', amountPaise: -1 }] })).toThrow(
      'must be more than zero',
    );
  });
});

describe('vendorPayment', () => {
  it('pays from the same firm without inter-firm lines', () => {
    const draft = vendorPayment({
      billFirmId: JI, vendorId: VENDOR, from: JI_BANK, amountPaise: 100_000, paymentDate: '2026-10-22', reference: 'UTR1',
    });
    expect(draft.firmId).toBe(JI);
    expect(draft.lines).toHaveLength(2);
    expect(sumOf(draft)).toBe(0);
  });

  it('refuses a payment from another firm’s account: firms are independent', () => {
    expect(() => vendorPayment({
      billFirmId: AB, vendorId: VENDOR, from: JI_BANK, amountPaise: 20_000_000, paymentDate: '2026-10-22', reference: 'UTR9',
    })).toThrow('own bank or cash');
  });

  it('takes a payment without a cheque number or UTR, from the bank or the firm’s cash', () => {
    const input = { billFirmId: JI, vendorId: VENDOR, amountPaise: 100, paymentDate: '2026-10-22' };
    expect(vendorPayment({ ...input, from: JI_BANK }).reference).toBe('');
    // A firm pays cash from its own cash account; common owner cash is not a firm's.
    expect(vendorPayment({ ...input, billFirmId: JI, from: { id: 'acct-ji-cash', kind: 'owner_cash', firmId: JI } }).firmId).toBe(JI);
  });
});
