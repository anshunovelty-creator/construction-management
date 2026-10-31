import { percentOf, type Paise } from '@/lib/money';
import { assertBalanced, assertDate, assertPositive } from '../balance';
import type { PricedItem } from '../bill-items';
import type { CostHead, EntryDraft, LineDraft, MoneyAccountRef } from '../types';

export interface VendorBillInput {
  id?: string;
  firmId: string;
  vendorId: string;
  siteId: string;
  billDate: string;
  billNo: string;
  /** The site's cost, before GST, by type. */
  items: { costHead: CostHead; amountPaise: Paise }[];
  /** GST on the bill: the firm can claim it back, so it is not a site cost. */
  gstPaise?: Paise;
  /** The bill's item lines, kept with the entry; their amounts and GST add up to `items` and `gstPaise`. */
  billItems?: PricedItem[];
  /** TDS we deduct from the bill, as a rate on the amount before GST. Owed to the government, so the vendor is paid less. */
  tds?: { rateBp: number; section: string };
  narration?: string;
  materialId?: string;
}

/**
 * A vendor's bill: the site's cost goes up by the amount before GST, the GST is ours to claim, and the firm owes
 * the vendor the total less any TDS. The TDS is owed to the government.
 */
export function vendorBill(input: VendorBillInput): EntryDraft {
  assertDate(input.billDate, 'bill date');
  if (input.billNo.trim() === '') {
    throw new Error('bill number is required');
  }
  if (input.items.length === 0) {
    throw new Error('a bill needs at least one item');
  }
  const costLines: LineDraft[] = input.items.map((item, index) => {
    assertPositive(item.amountPaise, `item ${index + 1} amount`);
    return {
      account: 'site_cost',
      amountPaise: item.amountPaise,
      firmId: input.firmId,
      siteId: input.siteId,
      costHead: item.costHead,
      partyId: input.vendorId,
    };
  });
  const gst = input.gstPaise ?? 0;
  if (gst < 0) throw new Error('GST cannot be less than zero');
  const base = costLines.reduce((sum, line) => sum + line.amountPaise, 0);
  const total = base + gst;
  // TDS is worked out on the amount before GST.
  const tdsPaise = input.tds ? percentOf(base, input.tds.rateBp) : 0;
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'vendor_bill',
    entryDate: input.billDate,
    firmId: input.firmId,
    partyId: input.vendorId,
    reference: input.billNo.trim(),
    narration: input.narration ?? '',
    materialId: input.materialId,
    items: input.billItems,
    tds: input.tds && { rateBp: input.tds.rateBp, section: input.tds.section, basePaise: base, tdsPaise },
    lines: [
      ...costLines,
      ...(gst > 0 ? [{ account: 'gst_input' as const, amountPaise: gst, firmId: input.firmId, partyId: input.vendorId }] : []),
      ...(tdsPaise > 0 ? [{ account: 'tds_payable' as const, amountPaise: -tdsPaise, firmId: input.firmId, partyId: input.vendorId }] : []),
      { account: 'vendor_payable', amountPaise: -(total - tdsPaise), firmId: input.firmId, partyId: input.vendorId },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface VendorPaymentInput {
  id?: string;
  /** The firm that owes the vendor (the firm on the vendor's bills). */
  billFirmId: string;
  vendorId: string;
  from: MoneyAccountRef;
  amountPaise: Paise;
  paymentDate: string;
  /** Cheque number or UTR, when there is one (optional, owner decision 2026-10-31). */
  reference?: string;
  narration?: string;
}

/**
 * Paying a vendor reduces what the bill firm owes, from the bill firm's own bank or cash. Paying before any bill
 * simply leaves a negative payable, which reports show as an advance to the vendor.
 */
export function vendorPayment(input: VendorPaymentInput): EntryDraft {
  assertDate(input.paymentDate, 'payment date');
  assertPositive(input.amountPaise, 'payment amount');
  // Firms are independent: the bill firm pays from its own bank or cash only.
  if (input.from.firmId !== input.billFirmId) {
    throw new Error('a payment must come from this firm’s own bank or cash account');
  }
  const reference = (input.reference ?? '').trim();
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'vendor_payment',
    entryDate: input.paymentDate,
    firmId: input.from.firmId,
    partyId: input.vendorId,
    reference,
    narration: input.narration ?? '',
    lines: [
      { account: 'vendor_payable', amountPaise: input.amountPaise, firmId: input.billFirmId, partyId: input.vendorId },
      { account: 'money', amountPaise: -input.amountPaise, firmId: input.from.firmId, moneyAccountId: input.from.id },
    ],
  };
  assertBalanced(draft);
  return draft;
}
