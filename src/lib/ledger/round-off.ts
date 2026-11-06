import { randomUUID } from 'node:crypto';
import type { Paise } from '@/lib/money';
import type { EntryDraft, LineDraft } from './types';

const isSmall = (paise: Paise) => paise !== 0 && Math.abs(paise) < 100;

/** The party's line in an entry: a vendor's bill or payment, or a client's bill or receipt. */
export function partyLine(draft: EntryDraft): LineDraft | undefined {
  return draft.lines.find((l) => l.partyId && (l.account === 'vendor_payable' || l.account === 'client_receivable'));
}

/**
 * What to clear after an entry, in the party account's own sign: the remainder under ₹1 it leaves, or failing that a
 * remainder from before it, so an old one does not ride along on the new bill. Ledger rows are never changed, so
 * clearing means posting the opposite.
 */
export function roundOffAmount(before: Paise, after: Paise): Paise {
  if (isSmall(after)) return after;
  return isSmall(before) ? before : 0;
}

/**
 * The entry that clears a remainder: a payment line for a vendor, a receipt line for a client, with no money moving.
 * Either way round: a line the other way shows as a small negative payment, so every total and statement counts it.
 */
// ponytail: books against cash_short_excess rather than an account of its own; add one if the accountant wants round offs apart.
export function roundOffDraft(line: LineDraft, remainder: Paise, entryDate: string): EntryDraft {
  return {
    id: randomUUID(),
    entryType: line.account === 'vendor_payable' ? 'vendor_payment' : 'client_receipt',
    entryDate,
    firmId: line.firmId ?? null,
    partyId: line.partyId,
    reference: 'Round off',
    narration: 'Round off',
    lines: [
      { account: line.account, amountPaise: -remainder, firmId: line.firmId, partyId: line.partyId },
      { account: 'cash_short_excess', amountPaise: remainder, firmId: line.firmId },
    ],
  };
}
