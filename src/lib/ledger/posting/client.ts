import type { Paise } from '@/lib/money';
import { assertBalanced, assertDate, assertPositive } from '../balance';
import type { PricedItem } from '../bill-items';
import type { ClientRef, EntryDraft, LineDraft, MoneyAccountRef } from '../types';

export interface ClientBillDeductions {
  tdsPaise?: Paise;
  retentionPaise?: Paise;
  securityDepositPaise?: Paise;
  /** Client-supplied material charged back to us: a material cost at this site. */
  materialRecoveryPaise?: Paise;
  /** Penalties or other cuts: an "other" cost at this site. */
  otherPaise?: Paise;
}

export interface ClientBillInput {
  id?: string;
  /** The firm billing, the client, and the site the work was done at. */
  client: ClientRef;
  billDate: string;
  billNo: string;
  /** The bill before GST: the work done. */
  grossPaise: Paise;
  /** GST charged on top: collected for the government, so it is not income. */
  gstPaise?: Paise;
  /** The bill's item lines, kept with the entry; their amounts and GST add up to `grossPaise` and `gstPaise`. */
  billItems?: PricedItem[];
  deductions: ClientBillDeductions;
  /** The TDS rate the client deducts (its amount is `deductions.tdsPaise`), kept for the TDS record. */
  tds?: { rateBp: number; section: string };
  narration?: string;
}

/**
 * A running/stage bill to the client. Income is the gross amount before GST, at the bill's site; the GST is owed to
 * the government. TDS, retention and security deposit stay ours (held by the client or claimable), so they
 * are assets. Recoveries and penalties are costs. The client owes the rest of gross + GST.
 * An earlier client advance (negative receivable) nets off automatically.
 */
export function clientBill(input: ClientBillInput): EntryDraft {
  assertDate(input.billDate, 'bill date');
  assertPositive(input.grossPaise, 'gross amount');
  if (input.billNo.trim() === '') {
    throw new Error('bill number is required');
  }
  const c = input.client;
  if (!c.siteId) {
    throw new Error('a client bill needs the site the work was done at');
  }
  const dims = { firmId: c.firmId, partyId: c.clientId, siteId: c.siteId };
  const d = input.deductions;
  const deductionLines: LineDraft[] = [];
  const addDeduction = (amount: Paise | undefined, label: string, line: Omit<LineDraft, 'amountPaise'>) => {
    if (amount === undefined || amount === 0) return;
    assertPositive(amount, label);
    deductionLines.push({ ...line, amountPaise: amount });
  };
  addDeduction(d.tdsPaise, 'TDS', { account: 'tds_claimable', ...dims });
  addDeduction(d.retentionPaise, 'retention', { account: 'retention_held', ...dims });
  addDeduction(d.securityDepositPaise, 'security deposit', { account: 'security_deposit_held', ...dims });
  addDeduction(d.materialRecoveryPaise, 'material recovery', { account: 'site_cost', ...dims, costHead: 'material' });
  addDeduction(d.otherPaise, 'other deduction', { account: 'site_cost', ...dims, costHead: 'other' });

  const gst = input.gstPaise ?? 0;
  if (gst < 0) throw new Error('GST cannot be less than zero');
  const totalDeductions = deductionLines.reduce((sum, line) => sum + line.amountPaise, 0);
  const net = input.grossPaise + gst - totalDeductions;
  if (net < 0) {
    throw new Error('deductions are more than the bill amount');
  }
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'client_bill',
    entryDate: input.billDate,
    firmId: c.firmId,
    partyId: c.clientId,
    reference: input.billNo.trim(),
    narration: input.narration ?? '',
    items: input.billItems,
    tds: input.tds && { rateBp: input.tds.rateBp, section: input.tds.section, basePaise: input.grossPaise, tdsPaise: d.tdsPaise ?? 0 },
    lines: [
      ...(net > 0 ? [{ account: 'client_receivable' as const, amountPaise: net, ...dims }] : []),
      ...deductionLines,
      { account: 'contract_income', amountPaise: -input.grossPaise, ...dims },
      ...(gst > 0 ? [{ account: 'gst_output' as const, amountPaise: -gst, firmId: c.firmId, partyId: c.clientId }] : []),
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface ClientReceiptInput {
  id?: string;
  /** The firm receiving and the client paying; the site is optional. */
  client: ClientRef;
  to: MoneyAccountRef;
  amountPaise: Paise;
  receiptDate: string;
  /** UTR or cheque number, when there is one (optional, owner decision 2026-10-31). */
  reference?: string;
  narration?: string;
}

/**
 * Money received from the client, into the firm's own bank or cash. Receiving before a bill leaves a negative
 * receivable (a client advance).
 */
export function clientReceipt(input: ClientReceiptInput): EntryDraft {
  assertDate(input.receiptDate, 'receipt date');
  assertPositive(input.amountPaise, 'receipt amount');
  const c = input.client;
  // Firms are independent: the money lands in the client's firm's own account.
  if (input.to.firmId !== c.firmId) {
    throw new Error('a receipt must go to this firm’s own bank or cash account');
  }
  const reference = (input.reference ?? '').trim();
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'client_receipt',
    entryDate: input.receiptDate,
    firmId: input.to.firmId,
    partyId: c.clientId,
    reference,
    narration: input.narration ?? '',
    lines: [
      { account: 'money', amountPaise: input.amountPaise, firmId: input.to.firmId, moneyAccountId: input.to.id },
      { account: 'client_receivable', amountPaise: -input.amountPaise, firmId: c.firmId, partyId: c.clientId, siteId: c.siteId },
    ],
  };
  assertBalanced(draft);
  return draft;
}
