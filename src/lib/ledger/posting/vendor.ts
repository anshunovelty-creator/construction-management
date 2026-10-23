import type { Paise } from '@/lib/money';
import { assertBalanced, assertDate, assertPositive } from '../balance';
import { interFirmLines } from '../inter-firm';
import type { CostHead, EntryDraft, LineDraft, MoneyAccountRef } from '../types';

export interface VendorBillInput {
  id?: string;
  firmId: string;
  vendorId: string;
  siteId: string;
  billDate: string;
  billNo: string;
  items: { costHead: CostHead; amountPaise: Paise }[];
  narration?: string;
}

/** A vendor's bill: the site's cost goes up and the firm owes the vendor the total. */
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
  const total = costLines.reduce((sum, line) => sum + line.amountPaise, 0);
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'vendor_bill',
    entryDate: input.billDate,
    firmId: input.firmId,
    partyId: input.vendorId,
    reference: input.billNo.trim(),
    narration: input.narration ?? '',
    lines: [
      ...costLines,
      { account: 'vendor_payable', amountPaise: -total, firmId: input.firmId, partyId: input.vendorId },
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
  /** Cheque number or UTR. Required for bank payments. */
  reference?: string;
  narration?: string;
}

/**
 * Paying a vendor reduces what the bill firm owes. If another firm's bank pays,
 * the bill firm now owes that firm (inter-firm lines). Paying before any bill
 * simply leaves a negative payable, which reports show as an advance to the vendor.
 */
export function vendorPayment(input: VendorPaymentInput): EntryDraft {
  assertDate(input.paymentDate, 'payment date');
  assertPositive(input.amountPaise, 'payment amount');
  const reference = (input.reference ?? '').trim();
  if (input.from.kind === 'bank' && reference === '') {
    throw new Error('cheque number or UTR is required for bank payments');
  }
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
      ...interFirmLines(input.from.firmId, input.billFirmId, input.amountPaise),
    ],
  };
  assertBalanced(draft);
  return draft;
}
