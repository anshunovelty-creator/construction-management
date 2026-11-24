import { percentOf, assertPaise, type Paise } from '@/lib/money';
import { assertBalanced, assertDate, assertPositive } from '../balance';
import { interFirmLines } from '../inter-firm';
import type { EntryDraft, MoneyAccountRef } from '../types';

/** Every entry here is one entry in two firms' books: each firm's own lines add up to zero, and the two dues mirror. */

function twoFirms(a: string | null, b: string | null): void {
  if (!a || !b || a === b) throw new Error('choose two different firms');
}

export interface FirmTransferInput {
  id?: string;
  from: MoneyAccountRef;
  to: MoneyAccountRef;
  amountPaise: Paise;
  date: string;
  reference?: string;
  narration?: string;
}

/** One firm's money goes to another firm: not a cost and not income. The firm that gets it owes it, or is paid what it was owed. */
export function firmTransfer(input: FirmTransferInput): EntryDraft {
  assertDate(input.date, 'date');
  assertPositive(input.amountPaise, 'amount');
  twoFirms(input.from.firmId, input.to.firmId);
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'firm_transfer',
    entryDate: input.date,
    firmId: input.from.firmId,
    reference: (input.reference ?? '').trim(),
    narration: (input.narration ?? '').trim(),
    lines: [
      { account: 'money', amountPaise: -input.amountPaise, firmId: input.from.firmId, moneyAccountId: input.from.id },
      { account: 'money', amountPaise: input.amountPaise, firmId: input.to.firmId, moneyAccountId: input.to.id },
      ...interFirmLines(input.from.firmId, input.to.firmId, input.amountPaise),
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface FirmSupplyInput {
  id?: string;
  kind: 'labour_supplied' | 'machine_rent';
  /** The firm that gave the labour or the machine, and the firm whose site it was at. */
  supplierId: string;
  takerId: string;
  siteId: string;
  /** Before GST. */
  amountPaise: Paise;
  /** Basis points on the amount; left out, none. */
  gstBp?: number;
  tdsBp?: number;
  date: string;
  reference?: string;
  narration?: string;
}

/**
 * Labour or a machine given by one of our firms to another's site: the taker's site cost and the supplier's income, with
 * no money moving. The taker then owes the amount with GST, less any TDS it keeps for the government.
 */
export function firmSupply(input: FirmSupplyInput): EntryDraft {
  assertDate(input.date, 'date');
  assertPositive(input.amountPaise, 'amount');
  twoFirms(input.supplierId, input.takerId);
  const { supplierId, takerId, amountPaise } = input;
  const costHead = input.kind === 'labour_supplied' ? 'labour' as const : 'machine_hire' as const;
  const gst = percentOf(amountPaise, input.gstBp ?? 0);
  const tds = percentOf(amountPaise, input.tdsBp ?? 0);
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: input.kind,
    entryDate: input.date,
    firmId: supplierId,
    reference: (input.reference ?? '').trim(),
    narration: (input.narration ?? '').trim(),
    lines: [
      { account: 'site_cost', amountPaise, firmId: takerId, siteId: input.siteId, costHead },
      { account: 'firm_income', amountPaise: -amountPaise, firmId: supplierId, counterFirmId: takerId, costHead },
      ...(gst > 0 ? [
        { account: 'gst_input' as const, amountPaise: gst, firmId: takerId, counterFirmId: supplierId },
        { account: 'gst_output' as const, amountPaise: -gst, firmId: supplierId, counterFirmId: takerId },
      ] : []),
      ...(tds > 0 ? [
        { account: 'tds_payable' as const, amountPaise: -tds, firmId: takerId, counterFirmId: supplierId },
        { account: 'tds_claimable' as const, amountPaise: tds, firmId: supplierId, counterFirmId: takerId },
      ] : []),
      ...interFirmLines(supplierId, takerId, amountPaise + gst - tds),
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface PaidForFirmInput {
  id?: string;
  /** The account that paid, of one firm, and the firm whose party was paid. */
  from: MoneyAccountRef;
  billFirmId: string;
  vendorId: string;
  amountPaise: Paise;
  date: string;
  reference?: string;
  narration?: string;
}

/** One firm pays another firm's party: that firm owes the party less, and owes the firm that paid. */
export function paidForFirm(input: PaidForFirmInput): EntryDraft {
  assertDate(input.date, 'date');
  assertPositive(input.amountPaise, 'amount');
  twoFirms(input.from.firmId, input.billFirmId);
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'vendor_payment',
    entryDate: input.date,
    firmId: input.from.firmId,
    partyId: input.vendorId,
    reference: (input.reference ?? '').trim(),
    narration: (input.narration ?? '').trim(),
    lines: [
      { account: 'vendor_payable', amountPaise: input.amountPaise, firmId: input.billFirmId, partyId: input.vendorId },
      { account: 'money', amountPaise: -input.amountPaise, firmId: input.from.firmId, moneyAccountId: input.from.id },
      ...interFirmLines(input.from.firmId, input.billFirmId, input.amountPaise),
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface OpeningFirmsInput {
  id?: string;
  firmId: string;
  counterFirmId: string;
  /** Above zero: the other firm owes this one. Below zero: this one owes it. */
  amountPaise: Paise;
  asOf: string;
}

/** What two of our firms owed each other when the app started, in both books. */
export function openingFirms(input: OpeningFirmsInput): EntryDraft {
  assertDate(input.asOf, 'opening date');
  assertPaise(input.amountPaise, 'opening balance');
  if (input.amountPaise === 0) throw new Error('opening balance cannot be zero');
  twoFirms(input.firmId, input.counterFirmId);
  const { firmId, counterFirmId, amountPaise } = input;
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'opening',
    entryDate: input.asOf,
    firmId,
    narration: 'Opening balance between firms',
    lines: [
      ...interFirmLines(firmId, counterFirmId, amountPaise),
      { account: 'opening_balance', amountPaise: -amountPaise, firmId },
      { account: 'opening_balance', amountPaise, firmId: counterFirmId },
    ],
  };
  assertBalanced(draft);
  return draft;
}
