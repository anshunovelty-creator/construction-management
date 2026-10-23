import { assertPaise, type Paise } from '@/lib/money';
import { assertBalanced, assertDate } from '../balance';
import type { EntryDraft, MoneyAccountRef, WorkOrderRef } from '../types';

function assertNonZero(amount: Paise, label: string): void {
  assertPaise(amount, label);
  if (amount === 0) {
    throw new Error(`${label} cannot be zero`);
  }
}

export interface OpeningVendorInput {
  id?: string;
  firmId: string;
  vendorId: string;
  /** Positive = we owe the vendor. Negative = advance already paid to the vendor. */
  amountPaise: Paise;
  asOf: string;
  reference?: string;
}

/** Starting balance with a vendor, e.g. from the 21-Oct-2026 outstanding statements. */
export function openingVendorBalance(input: OpeningVendorInput): EntryDraft {
  assertDate(input.asOf, 'opening date');
  assertNonZero(input.amountPaise, 'opening vendor balance');
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'opening',
    entryDate: input.asOf,
    firmId: input.firmId,
    partyId: input.vendorId,
    reference: input.reference ?? '',
    narration: 'Opening vendor balance',
    lines: [
      { account: 'opening_balance', amountPaise: input.amountPaise },
      { account: 'vendor_payable', amountPaise: -input.amountPaise, firmId: input.firmId, partyId: input.vendorId },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface OpeningMoneyInput {
  id?: string;
  account: MoneyAccountRef;
  amountPaise: Paise;
  asOf: string;
}

/** Starting balance of a bank or cash account. */
export function openingMoneyBalance(input: OpeningMoneyInput): EntryDraft {
  assertDate(input.asOf, 'opening date');
  assertNonZero(input.amountPaise, 'opening money balance');
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'opening',
    entryDate: input.asOf,
    firmId: input.account.firmId,
    narration: 'Opening money balance',
    lines: [
      { account: 'money', amountPaise: input.amountPaise, firmId: input.account.firmId, moneyAccountId: input.account.id },
      { account: 'opening_balance', amountPaise: -input.amountPaise },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface OpeningClientInput {
  id?: string;
  workOrder: WorkOrderRef;
  /** Positive = client owes us. Negative = client advance not yet billed. */
  amountPaise: Paise;
  asOf: string;
}

/** Starting amount a client owes on a work order. */
export function openingClientBalance(input: OpeningClientInput): EntryDraft {
  assertDate(input.asOf, 'opening date');
  assertNonZero(input.amountPaise, 'opening client balance');
  const wo = input.workOrder;
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'opening',
    entryDate: input.asOf,
    firmId: wo.firmId,
    partyId: wo.clientId,
    narration: 'Opening client balance',
    lines: [
      {
        account: 'client_receivable',
        amountPaise: input.amountPaise,
        firmId: wo.firmId,
        partyId: wo.clientId,
        siteId: wo.siteId,
        workOrderId: wo.id,
      },
      { account: 'opening_balance', amountPaise: -input.amountPaise },
    ],
  };
  assertBalanced(draft);
  return draft;
}
