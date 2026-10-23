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

  it("records that the bill firm owes the paying firm when another firm's bank pays", () => {
    const draft = vendorPayment({
      billFirmId: AB, vendorId: VENDOR, from: JI_BANK, amountPaise: 20_000_000, paymentDate: '2026-10-22', reference: 'UTR9',
    });
    expect(draft.lines).toEqual([
      { account: 'vendor_payable', amountPaise: 20_000_000, firmId: AB, partyId: VENDOR },
      { account: 'money', amountPaise: -20_000_000, firmId: JI, moneyAccountId: JI_BANK.id },
      { account: 'inter_firm', amountPaise: 20_000_000, firmId: JI, counterFirmId: AB },
      { account: 'inter_firm', amountPaise: -20_000_000, firmId: AB, counterFirmId: JI },
    ]);
  });

  it('requires a cheque number or UTR for bank payments but not for cash', () => {
    const input = { billFirmId: JI, vendorId: VENDOR, amountPaise: 100, paymentDate: '2026-10-22' };
    expect(() => vendorPayment({ ...input, from: JI_BANK })).toThrow('cheque number or UTR is required');
    expect(vendorPayment({ ...input, from: OWNER_CASH }).firmId).toBeNull();
  });
});
