import type { Paise } from '@/lib/money';

/** Mirrors the Postgres enums in supabase/migrations. Keep both in sync. */
export const COST_HEADS = [
  'material',
  'labour',
  'staff',
  'machine_hire',
  'subcontract',
  'site_overhead',
  'transport',
  'other',
] as const;
export type CostHead = (typeof COST_HEADS)[number];

export type LedgerAccount =
  | 'money'
  | 'vendor_payable'
  | 'client_receivable'
  | 'retention_held'
  | 'security_deposit_held'
  | 'tds_claimable'
  | 'inter_firm'
  | 'site_cost'
  | 'contract_income'
  | 'owner_capital'
  | 'opening_balance'
  | 'cash_short_excess';

/** Entry types the app may post directly. Reversals are created only by the database. */
export type PostableEntryType =
  | 'opening'
  | 'vendor_bill'
  | 'vendor_payment'
  | 'site_cash_expense'
  | 'client_bill'
  | 'client_receipt'
  | 'cash_transfer'
  | 'cash_close_difference'
  | 'owner_capital'
  | 'owner_drawing';

export type MoneyAccountKind = 'bank' | 'owner_cash' | 'supervisor_cash';

/** Positive amount = debit, negative = credit. An entry's lines always sum to zero. */
export interface LineDraft {
  account: LedgerAccount;
  amountPaise: Paise;
  firmId?: string | null;
  counterFirmId?: string;
  moneyAccountId?: string;
  partyId?: string;
  siteId?: string;
  workOrderId?: string;
  costHead?: CostHead;
}

export interface EntryDraft {
  id: string;
  entryType: PostableEntryType;
  /** YYYY-MM-DD */
  entryDate: string;
  /** Firm whose serial series this entry uses; null = common (CM) series. */
  firmId: string | null;
  partyId?: string;
  reference?: string;
  narration?: string;
  lines: LineDraft[];
}

export interface MoneyAccountRef {
  id: string;
  kind: MoneyAccountKind;
  /** Bank accounts belong to a firm; owner and supervisor cash are common (null). */
  firmId: string | null;
}

export interface WorkOrderRef {
  id: string;
  firmId: string;
  clientId: string;
  siteId: string;
}
