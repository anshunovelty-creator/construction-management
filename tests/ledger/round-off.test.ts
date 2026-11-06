import { expect, it } from 'vitest';
import { partyLine, roundOffAmount, roundOffDraft } from '@/lib/ledger/round-off';
import type { EntryDraft } from '@/lib/ledger/types';

it('clears what the entry leaves under ₹1, else what was already there, but never ₹1 or more', () => {
  expect(roundOffAmount(-10_050, -50)).toBe(-50);
  expect(roundOffAmount(0, 99)).toBe(99);
  expect(roundOffAmount(-50, -10_050)).toBe(-50); // an old 50 paise, then a new ₹100 bill: only the old part goes
  expect(roundOffAmount(0, -100)).toBe(0);
  expect(roundOffAmount(-200, -100)).toBe(0);
  expect(roundOffAmount(0, 0)).toBe(0);
});

it('posts the opposite of the remainder, balanced, with no money moving', () => {
  const line = { account: 'vendor_payable', amountPaise: 1, firmId: 'f', partyId: 'p' } as const;
  const draft = roundOffDraft(line, -50, '2026-11-06');
  expect(draft).toMatchObject({ entryType: 'vendor_payment', firmId: 'f', partyId: 'p', narration: 'Round off', entryDate: '2026-11-06' });
  expect(draft.lines.map((l) => [l.account, l.amountPaise])).toEqual([['vendor_payable', 50], ['cash_short_excess', -50]]);
  expect(roundOffDraft({ ...line, account: 'client_receivable' }, 99, '2026-11-06').entryType).toBe('client_receipt');
});

it('finds the party line of an entry, and none on a cash transfer', () => {
  const lines = [{ account: 'money', amountPaise: -5, moneyAccountId: 'm' }, { account: 'vendor_payable', amountPaise: 5, firmId: 'f', partyId: 'p' }];
  expect(partyLine({ lines } as EntryDraft)?.partyId).toBe('p');
  expect(partyLine({ lines: lines.slice(0, 1) } as EntryDraft)).toBeUndefined();
});
