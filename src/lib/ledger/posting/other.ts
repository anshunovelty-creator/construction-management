import type { Paise } from '@/lib/money';
import { assertBalanced, assertDate, assertPositive } from '../balance';
import type { CostHead, EntryDraft, LedgerAccount, LineDraft, MoneyAccountRef } from '../types';

interface Reason {
  account: LedgerAccount;
  head?: CostHead;
  /** Who it is with, for money a client held or a party gives back. */
  party?: 'client' | 'vendor';
  /** Tax: the month it is for. */
  month?: boolean;
  /** A note is needed to know later what it was. */
  note?: boolean;
}

/** Money in that is not from a client's bill, and money out that is not a party's bill: what it is, and where it counts. */
export const REASONS = {
  in: {
    machine_rent: { account: 'other_income', head: 'machine_hire', note: true },
    retention_back: { account: 'retention_held', party: 'client' },
    deposit_back_client: { account: 'security_deposit_held', party: 'client' },
    party_back: { account: 'vendor_payable', party: 'vendor' },
    loan_in: { account: 'loan', note: true },
    deposit_back: { account: 'deposit_given', note: true },
    gst_refund: { account: 'gst_paid', month: true },
    tds_refund: { account: 'tds_claimed' },
    other_income: { account: 'other_income', head: 'other', note: true },
  },
  out: {
    office: { account: 'firm_cost', head: 'office', note: true },
    bank_charges: { account: 'firm_cost', head: 'bank_charges' },
    gst_paid: { account: 'gst_paid', month: true },
    tds_paid: { account: 'tds_paid', month: true },
    pf_paid: { account: 'pf_paid', month: true },
    interest: { account: 'firm_cost', head: 'interest' },
    loan_out: { account: 'loan', note: true },
    deposit_given: { account: 'deposit_given', note: true },
    client_back: { account: 'client_receivable', party: 'client', note: true },
    other_cost: { account: 'firm_cost', head: 'other', note: true },
  },
} as const satisfies Record<'in' | 'out', Record<string, Reason>>;

export const IN_REASONS = Object.keys(REASONS.in) as (keyof typeof REASONS.in)[];
export const OUT_REASONS = Object.keys(REASONS.out) as (keyof typeof REASONS.out)[];
export type MoneyReason = (typeof IN_REASONS)[number] | (typeof OUT_REASONS)[number];
export const reasonOf = (reason: string): (Reason & { direction: 'in' | 'out' }) | undefined => {
  if (Object.hasOwn(REASONS.in, reason)) return { ...(REASONS.in as Record<string, Reason>)[reason]!, direction: 'in' };
  if (Object.hasOwn(REASONS.out, reason)) return { ...(REASONS.out as Record<string, Reason>)[reason]!, direction: 'out' };
  return undefined;
};

export interface OtherMoneyInput {
  id?: string;
  reason: string;
  account: MoneyAccountRef;
  amountPaise: Paise;
  date: string;
  partyId?: string;
  /** "2026-10", for tax. */
  month?: string;
  reference?: string;
  narration?: string;
}

export function otherMoney(input: OtherMoneyInput): EntryDraft {
  assertDate(input.date, 'date');
  assertPositive(input.amountPaise, 'amount');
  const reason = reasonOf(input.reason);
  if (!reason) throw new Error('choose what it was for');
  const narration = (input.narration ?? '').trim();
  if (reason.note && narration === '') throw new Error('say what it was for');
  if (reason.party && !input.partyId) throw new Error('choose who it was with');
  if (reason.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month ?? '')) throw new Error('choose the month it is for');
  const amount = reason.direction === 'in' ? input.amountPaise : -input.amountPaise;
  const firmId = input.account.firmId;
  const line: LineDraft = {
    account: reason.account, amountPaise: -amount, firmId,
    ...(reason.head ? { costHead: reason.head } : {}), ...(reason.party ? { partyId: input.partyId } : {}),
  };
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    // Money back from a party is a payment the other way round, and money back to a client (a cheque returned) a receipt
    // the other way round, so their ledgers count them there.
    entryType: reason.account === 'vendor_payable' ? 'vendor_payment' : reason.account === 'client_receivable' ? 'client_receipt' : reason.direction === 'in' ? 'other_in' : 'other_out',
    entryDate: input.date,
    firmId,
    ...(reason.party ? { partyId: input.partyId } : {}),
    reference: reason.month ? input.month! : (input.reference ?? '').trim(),
    narration: [narration, reason.month && (input.reference ?? '').trim()].filter(Boolean).join(' · '),
    lines: [{ account: 'money', amountPaise: amount, firmId, moneyAccountId: input.account.id }, line],
  };
  assertBalanced(draft);
  return draft;
}

/** Wages, salaries and advances given from one account, to one person or many; below zero, money handed back. */
export function wagesPaid(input: { id?: string; account: MoneyAccountRef; amountPaise: Paise; date: string; narration: string }): EntryDraft {
  assertDate(input.date, 'date');
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise === 0) throw new Error('amount cannot be zero');
  const firmId = input.account.firmId;
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(), entryType: 'wages_paid', entryDate: input.date, firmId, narration: input.narration,
    lines: [
      { account: 'money', amountPaise: -input.amountPaise, firmId, moneyAccountId: input.account.id },
      { account: 'wages_paid', amountPaise: input.amountPaise, firmId },
    ],
  };
  assertBalanced(draft);
  return draft;
}

/** A machine's service, paid by the firm that owns it. */
export function machineService(input: { id?: string; account: MoneyAccountRef; amountPaise: Paise; date: string; narration: string }): EntryDraft {
  assertDate(input.date, 'date');
  assertPositive(input.amountPaise, 'cost');
  const firmId = input.account.firmId;
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(), entryType: 'other_out', entryDate: input.date, firmId, narration: input.narration,
    lines: [
      { account: 'money', amountPaise: -input.amountPaise, firmId, moneyAccountId: input.account.id },
      { account: 'firm_cost', amountPaise: input.amountPaise, firmId, costHead: 'machine_service' },
    ],
  };
  assertBalanced(draft);
  return draft;
}
