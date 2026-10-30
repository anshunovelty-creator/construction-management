import type { EntryDraft, MoneyAccountRef, ClientRef } from '@/lib/ledger/types';

/** Fake ids for pure posting-rule tests (no database involved). */
export const JI = 'firm-jayraj';
export const AB = 'firm-ab';
export const SVG = 'site-svg';
export const VENDOR = 'party-ansari';
export const CLIENT = 'party-svg-client';
export const SVG_CLIENT: ClientRef = { firmId: JI, clientId: CLIENT, siteId: SVG };
export const JI_BANK: MoneyAccountRef = { id: 'acct-ji-bank', kind: 'bank', firmId: JI };
export const AB_BANK: MoneyAccountRef = { id: 'acct-ab-bank', kind: 'bank', firmId: AB };
export const OWNER_CASH: MoneyAccountRef = { id: 'acct-owner', kind: 'owner_cash', firmId: null };
export const RAMESH: MoneyAccountRef = { id: 'acct-ramesh', kind: 'supervisor_cash', firmId: null };

export const sumOf = (draft: EntryDraft) => draft.lines.reduce((total, line) => total + line.amountPaise, 0);
