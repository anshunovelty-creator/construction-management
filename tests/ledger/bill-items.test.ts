import { describe, expect, it } from 'vitest';
import { billTotals, priceItem, quantityToMilli } from '@/lib/ledger/bill-items';
import { clientBill } from '@/lib/ledger/posting/client';
import { vendorBill } from '@/lib/ledger/posting/vendor';
import { AB, CLIENT, JI, SVG, sumOf, VENDOR, SVG_CLIENT } from './fixtures';

describe('bill items', () => {
  it('reads quantities with up to three decimals', () => {
    expect(quantityToMilli('10')).toBe(10_000);
    expect(quantityToMilli('2.5')).toBe(2_500);
    expect(quantityToMilli('1,000.125')).toBe(1_000_125);
    for (const bad of ['0', '-1', '1.2345', 'ten', '']) expect(() => quantityToMilli(bad)).toThrow();
  });

  it('prices quantity × rate and the GST on it, rounding half-up to the paisa', () => {
    // 2.5 bags at ₹350.33 = ₹875.825 -> ₹875.83; 18% GST on that = ₹157.6494 -> ₹157.65.
    expect(priceItem({ materialId: 'm', quantityMilli: 2_500, ratePaise: 35_033, gstBp: 1_800 }))
      .toMatchObject({ amountPaise: 87_583, gstPaise: 15_765 });
    expect(priceItem({ materialId: 'm', quantityMilli: 1_000, ratePaise: 100, gstBp: 0 })).toMatchObject({ amountPaise: 100, gstPaise: 0 });
  });

  it('adds up the amount before GST, the GST and the total', () => {
    const items = [
      priceItem({ materialId: 'cement', quantityMilli: 100_000, ratePaise: 35_000, gstBp: 2_800 }),
      priceItem({ materialId: 'sand', quantityMilli: 10_000, ratePaise: 120_000, gstBp: 500 }),
    ];
    expect(billTotals(items)).toEqual({ base: 4_700_000, gst: 1_040_000, total: 5_740_000 });
  });

  it('books a vendor bill: site cost before GST, GST to claim, the vendor owed the total', () => {
    const draft = vendorBill({
      firmId: AB, vendorId: VENDOR, siteId: SVG, billDate: '2026-10-29', billNo: 'T-1',
      items: [{ costHead: 'material', amountPaise: 4_700_000 }], gstPaise: 1_040_000,
    });
    expect(draft.lines).toEqual([
      { account: 'site_cost', amountPaise: 4_700_000, firmId: AB, siteId: SVG, costHead: 'material', partyId: VENDOR },
      { account: 'gst_input', amountPaise: 1_040_000, firmId: AB, partyId: VENDOR },
      { account: 'vendor_payable', amountPaise: -5_740_000, firmId: AB, partyId: VENDOR },
    ]);
    expect(sumOf(draft)).toBe(0);
  });

  it('books a client bill: income before GST, GST owed to the government, the client owing the total after cuts', () => {
    const draft = clientBill({
      client: SVG_CLIENT, billDate: '2026-10-29', billNo: 'RA-9', grossPaise: 100_000_00, gstPaise: 18_000_00,
      deductions: { tdsPaise: 1_000_00 },
    });
    const dims = { firmId: JI, partyId: CLIENT, siteId: SVG };
    expect(draft.lines).toEqual([
      { account: 'client_receivable', amountPaise: 117_000_00, ...dims },
      { account: 'tds_claimable', amountPaise: 1_000_00, ...dims },
      { account: 'contract_income', amountPaise: -100_000_00, ...dims },
      { account: 'gst_output', amountPaise: -18_000_00, firmId: JI, partyId: CLIENT },
    ]);
  });
});
