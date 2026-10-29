import { assertPaise, type Paise } from '@/lib/money';
import { assertBalanced, assertDate, assertPositive } from '../balance';
import type { CostHead, EntryDraft, MoneyAccountRef } from '../types';

export interface SiteCashExpenseInput {
  id?: string;
  from: MoneyAccountRef;
  siteId: string;
  costHead: CostHead;
  amountPaise: Paise;
  expenseDate: string;
  /** Vendor/worker party if known; small items can leave it out and use the narration. */
  paidToPartyId?: string;
  narration: string;
  materialId?: string;
}

/** Money spent directly on a site (usually by a supervisor from their cash). */
export function siteCashExpense(input: SiteCashExpenseInput): EntryDraft {
  assertDate(input.expenseDate, 'expense date');
  assertPositive(input.amountPaise, 'expense amount');
  if (input.narration.trim() === '') {
    throw new Error('say what the money was spent on');
  }
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'site_cash_expense',
    entryDate: input.expenseDate,
    firmId: input.from.firmId,
    ...(input.paidToPartyId ? { partyId: input.paidToPartyId } : {}),
    narration: input.narration.trim(),
    materialId: input.materialId,
    lines: [
      {
        account: 'site_cost',
        amountPaise: input.amountPaise,
        firmId: input.from.firmId,
        siteId: input.siteId,
        costHead: input.costHead,
        ...(input.paidToPartyId ? { partyId: input.paidToPartyId } : {}),
      },
      { account: 'money', amountPaise: -input.amountPaise, firmId: input.from.firmId, moneyAccountId: input.from.id },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface CashTransferInput {
  id?: string;
  from: MoneyAccountRef;
  to: MoneyAccountRef;
  amountPaise: Paise;
  transferDate: string;
  reference?: string;
  narration?: string;
}

/**
 * Moving money between our own accounts within one firm (bank to owner cash, owner to supervisor).
 * Not an expense. Money never moves between firms.
 */
export function cashTransfer(input: CashTransferInput): EntryDraft {
  assertDate(input.transferDate, 'transfer date');
  assertPositive(input.amountPaise, 'transfer amount');
  if (input.from.id === input.to.id) {
    throw new Error('cannot transfer to the same account');
  }
  // Firms are independent: money moves only within one firm (or among common accounts).
  if (input.from.firmId !== input.to.firmId) {
    throw new Error('money cannot move between firms');
  }
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'cash_transfer',
    entryDate: input.transferDate,
    firmId: input.from.firmId,
    reference: (input.reference ?? '').trim(),
    narration: input.narration ?? '',
    lines: [
      { account: 'money', amountPaise: input.amountPaise, firmId: input.to.firmId, moneyAccountId: input.to.id },
      { account: 'money', amountPaise: -input.amountPaise, firmId: input.from.firmId, moneyAccountId: input.from.id },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface CashCloseDifferenceInput {
  id?: string;
  account: MoneyAccountRef;
  expectedPaise: Paise;
  countedPaise: Paise;
  closeDate: string;
  narration?: string;
}

/** Day-close: counted cash differs from what the books expect. Records the shortage or excess. */
export function cashCloseDifference(input: CashCloseDifferenceInput): EntryDraft {
  assertDate(input.closeDate, 'close date');
  assertPaise(input.expectedPaise, 'expected cash');
  assertPaise(input.countedPaise, 'counted cash');
  if (input.countedPaise < 0) {
    throw new Error('counted cash cannot be negative');
  }
  const difference = input.countedPaise - input.expectedPaise;
  if (difference === 0) {
    throw new Error('counted cash matches the books; nothing to record');
  }
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'cash_close_difference',
    entryDate: input.closeDate,
    firmId: input.account.firmId,
    narration: input.narration ?? (difference < 0 ? 'Cash short at day close' : 'Cash excess at day close'),
    lines: [
      { account: 'money', amountPaise: difference, firmId: input.account.firmId, moneyAccountId: input.account.id },
      { account: 'cash_short_excess', amountPaise: -difference },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface OwnerMoneyInput {
  id?: string;
  account: MoneyAccountRef;
  amountPaise: Paise;
  date: string;
  narration?: string;
}

/** Owner puts personal money into the business. */
export function ownerCapital(input: OwnerMoneyInput): EntryDraft {
  assertDate(input.date, 'date');
  assertPositive(input.amountPaise, 'amount');
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'owner_capital',
    entryDate: input.date,
    firmId: input.account.firmId,
    narration: input.narration ?? '',
    lines: [
      { account: 'money', amountPaise: input.amountPaise, firmId: input.account.firmId, moneyAccountId: input.account.id },
      { account: 'owner_capital', amountPaise: -input.amountPaise },
    ],
  };
  assertBalanced(draft);
  return draft;
}

/** Owner takes business money for personal use. Recorded so it never looks like a site cost. */
export function ownerDrawing(input: OwnerMoneyInput): EntryDraft {
  assertDate(input.date, 'date');
  assertPositive(input.amountPaise, 'amount');
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'owner_drawing',
    entryDate: input.date,
    firmId: input.account.firmId,
    narration: input.narration ?? '',
    lines: [
      { account: 'owner_capital', amountPaise: input.amountPaise },
      { account: 'money', amountPaise: -input.amountPaise, firmId: input.account.firmId, moneyAccountId: input.account.id },
    ],
  };
  assertBalanced(draft);
  return draft;
}
