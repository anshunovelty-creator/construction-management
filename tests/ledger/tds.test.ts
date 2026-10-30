import { describe, expect, it } from 'vitest';
import { billTotals, priceItem } from '@/lib/ledger/bill-items';
import { clientBill } from '@/lib/ledger/posting/client';
import { vendorBill } from '@/lib/ledger/posting/vendor';
import { AB, CLIENT, JI, SVG, sumOf, VENDOR, SVG_CLIENT } from './fixtures';

const items = [
  priceItem({ materialId: 'cement', quantityMilli: 100_000, ratePaise: 35_000, gstBp: 2_800 }),
  priceItem({ materialId: 'sand', quantityMilli: 10_000, ratePaise: 120_000, gstBp: 500 }),
];
const { base, gst } = billTotals(items);

describe('TDS on bills', () => {
  it('takes vendor TDS on the amount before GST, owes it to the government, and pays the vendor the rest', () => {
    const draft = vendorBill({
      firmId: AB, vendorId: VENDOR, siteId: SVG, billDate: '2026-10-29', billNo: 'T-2',
      items: [{ costHead: 'material', amountPaise: base }], gstPaise: gst, billItems: items,
      tds: { rateBp: 100, section: '194C, individual or HUF' },
    });
    // 1% of ₹47,00,000 (before GST) is ₹47,000; the vendor's bill is ₹57,40,000, so ₹56,93,000 is paid.
    expect(draft.lines).toEqual([
      { account: 'site_cost', amountPaise: 4_700_000, firmId: AB, siteId: SVG, costHead: 'material', partyId: VENDOR },
      { account: 'gst_input', amountPaise: 1_040_000, firmId: AB, partyId: VENDOR },
      { account: 'tds_payable', amountPaise: -47_000, firmId: AB, partyId: VENDOR },
      { account: 'vendor_payable', amountPaise: -5_693_000, firmId: AB, partyId: VENDOR },
    ]);
    expect(sumOf(draft)).toBe(0);
    expect(draft.tds).toEqual({ rateBp: 100, section: '194C, individual or HUF', basePaise: 4_700_000, tdsPaise: 47_000 });
  });

  it('adds no TDS line for a 0% rate, but still records the rate', () => {
    const draft = vendorBill({
      firmId: AB, vendorId: VENDOR, siteId: SVG, billDate: '2026-10-29', billNo: 'T-3',
      items: [{ costHead: 'material', amountPaise: base }], gstPaise: gst, billItems: items,
      tds: { rateBp: 0, section: 'no TDS' },
    });
    expect(draft.lines.some((l) => l.account === 'tds_payable')).toBe(false);
    expect(draft.tds).toEqual({ rateBp: 0, section: 'no TDS', basePaise: 4_700_000, tdsPaise: 0 });
  });

  it('keeps a vendor bill with no TDS as it was', () => {
    const draft = vendorBill({
      firmId: AB, vendorId: VENDOR, siteId: SVG, billDate: '2026-10-29', billNo: 'T-4',
      items: [{ costHead: 'material', amountPaise: base }], gstPaise: gst, billItems: items,
    });
    expect(draft.tds).toBeUndefined();
    expect(draft.lines.at(-1)).toEqual({ account: 'vendor_payable', amountPaise: -5_740_000, firmId: AB, partyId: VENDOR });
  });

  it('records a client bill’s TDS on the amount before GST, as claimable from the client', () => {
    const draft = clientBill({
      client: SVG_CLIENT, billDate: '2026-10-29', billNo: 'RA-10', grossPaise: 100_000_00, gstPaise: 18_000_00,
      deductions: { tdsPaise: 1_000_00 }, tds: { rateBp: 100, section: '194C, company' },
    });
    expect(draft.tds).toEqual({ rateBp: 100, section: '194C, company', basePaise: 100_000_00, tdsPaise: 1_000_00 });
    expect(draft.lines.find((l) => l.account === 'tds_claimable')).toMatchObject({ amountPaise: 1_000_00, firmId: JI, partyId: CLIENT });
  });
});
