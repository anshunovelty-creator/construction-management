import type { Paise } from '@/lib/money';
import { assertBalanced, assertDate, assertPositive } from '../balance';
import { interFirmLines } from '../inter-firm';
import type { EntryDraft, LineDraft, MoneyAccountRef, WorkOrderRef } from '../types';

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
  workOrder: WorkOrderRef;
  billDate: string;
  billNo: string;
  grossPaise: Paise;
  deductions: ClientBillDeductions;
  narration?: string;
}

/**
 * A running/stage bill to the client. Income is the gross amount. TDS, retention and
 * security deposit stay ours (held by the client or claimable), so they are assets.
 * Recoveries and penalties are costs. The client owes the rest.
 * An earlier client advance (negative receivable) nets off automatically.
 */
export function clientBill(input: ClientBillInput): EntryDraft {
  assertDate(input.billDate, 'bill date');
  assertPositive(input.grossPaise, 'gross amount');
  if (input.billNo.trim() === '') {
    throw new Error('bill number is required');
  }
  const wo = input.workOrder;
  const woDims = { firmId: wo.firmId, partyId: wo.clientId, siteId: wo.siteId, workOrderId: wo.id };
  const d = input.deductions;
  const deductionLines: LineDraft[] = [];
  const addDeduction = (amount: Paise | undefined, label: string, line: Omit<LineDraft, 'amountPaise'>) => {
    if (amount === undefined || amount === 0) return;
    assertPositive(amount, label);
    deductionLines.push({ ...line, amountPaise: amount });
  };
  addDeduction(d.tdsPaise, 'TDS', { account: 'tds_claimable', ...woDims });
  addDeduction(d.retentionPaise, 'retention', { account: 'retention_held', ...woDims });
  addDeduction(d.securityDepositPaise, 'security deposit', { account: 'security_deposit_held', ...woDims });
  addDeduction(d.materialRecoveryPaise, 'material recovery', {
    account: 'site_cost', ...woDims, costHead: 'material',
  });
  addDeduction(d.otherPaise, 'other deduction', { account: 'site_cost', ...woDims, costHead: 'other' });

  const totalDeductions = deductionLines.reduce((sum, line) => sum + line.amountPaise, 0);
  const net = input.grossPaise - totalDeductions;
  if (net < 0) {
    throw new Error('deductions are more than the gross amount');
  }
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'client_bill',
    entryDate: input.billDate,
    firmId: wo.firmId,
    partyId: wo.clientId,
    reference: input.billNo.trim(),
    narration: input.narration ?? '',
    lines: [
      ...(net > 0 ? [{ account: 'client_receivable' as const, amountPaise: net, ...woDims }] : []),
      ...deductionLines,
      { account: 'contract_income', amountPaise: -input.grossPaise, ...woDims },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface ClientReceiptInput {
  id?: string;
  workOrder: WorkOrderRef;
  to: MoneyAccountRef;
  amountPaise: Paise;
  receiptDate: string;
  /** UTR or cheque number. Required for bank receipts. */
  reference?: string;
  narration?: string;
}

/**
 * Money received from the client. Receiving before a bill leaves a negative receivable
 * (a client advance). If it lands in another firm's bank, that firm now owes the work-order firm.
 */
export function clientReceipt(input: ClientReceiptInput): EntryDraft {
  assertDate(input.receiptDate, 'receipt date');
  assertPositive(input.amountPaise, 'receipt amount');
  const reference = (input.reference ?? '').trim();
  if (input.to.kind === 'bank' && reference === '') {
    throw new Error('UTR or cheque number is required for bank receipts');
  }
  const wo = input.workOrder;
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'client_receipt',
    entryDate: input.receiptDate,
    firmId: input.to.firmId,
    partyId: wo.clientId,
    reference,
    narration: input.narration ?? '',
    lines: [
      { account: 'money', amountPaise: input.amountPaise, firmId: input.to.firmId, moneyAccountId: input.to.id },
      {
        account: 'client_receivable',
        amountPaise: -input.amountPaise,
        firmId: wo.firmId,
        partyId: wo.clientId,
        siteId: wo.siteId,
        workOrderId: wo.id,
      },
      ...interFirmLines(wo.firmId, input.to.firmId, input.amountPaise),
    ],
  };
  assertBalanced(draft);
  return draft;
}
