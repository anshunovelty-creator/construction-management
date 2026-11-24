import type { Paise } from '@/lib/money';
import type { PricedItem } from './bill-items';

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
/** What a firm's own costs are for, beside a site's. */
export const FIRM_HEADS = ['office', 'bank_charges', 'interest', 'machine_service'] as const;
export type CostHead = (typeof COST_HEADS)[number] | (typeof FIRM_HEADS)[number];

export type LedgerAccount =
  | 'money'
  | 'vendor_payable'
  | 'client_receivable'
  | 'retention_held'
  | 'security_deposit_held'
  | 'tds_claimable'
  | 'inter_firm'
  | 'site_cost'
  /** Things bought to keep and reuse at any site: the company's, not a site's cost. */
  | 'company_assets'
  | 'contract_income'
  | 'owner_capital'
  | 'opening_balance'
  | 'cash_short_excess'
  | 'round_off'
  /** Money in or out that nobody can explain yet; sorted out by replacing the entry. */
  | 'not_yet_known'
  /** What one of our firms earns from another: labour or a machine supplied. */
  | 'firm_income'
  /** Salaries, wages and advances given; who got them is kept on their own accounts. */
  | 'wages_paid'
  /** A firm's own costs, not a site's: office, bank charges, interest, machine service. */
  | 'firm_cost'
  | 'other_income'
  /** Borrowed money still to pay back. ponytail: one balance per firm; keep it per lender when a firm has two. */
  | 'loan'
  /** Deposits we gave (tenders, rent) and get back. */
  | 'deposit_given'
  | 'gst_paid'
  | 'tds_paid'
  | 'pf_paid'
  /** TDS got back as a refund. */
  | 'tds_claimed'
  | 'gst_input'
  | 'gst_output'
  | 'tds_payable';

/** A bill's TDS for the TDS record: the rate and section used, the base it was worked out on (before GST), and the TDS. */
export interface BillTds {
  rateBp: number;
  section: string;
  basePaise: Paise;
  tdsPaise: Paise;
}

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
  | 'owner_drawing'
  | 'not_yet_known'
  | 'firm_transfer'
  | 'labour_supplied'
  | 'machine_rent'
  | 'wages_paid'
  | 'other_in'
  | 'other_out';

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
  /** What a bill was for, from the materials list. */
  materialId?: string;
  /** A bill's item lines (material, quantity, rate, GST), kept with the entry. Bills only. */
  items?: PricedItem[];
  /** A bill's TDS, kept with the entry for the TDS record. Bills only. */
  tds?: BillTds;
  lines: LineDraft[];
}

export interface MoneyAccountRef {
  id: string;
  kind: MoneyAccountKind;
  /** Every account belongs to a firm; null only for shared cash from before (switched off). */
  firmId: string | null;
}

/** A client of one firm. A bill names the site the work was done at; a receipt may leave it out. */
export interface ClientRef {
  firmId: string;
  clientId: string;
  siteId?: string;
}
