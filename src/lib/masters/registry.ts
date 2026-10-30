import type { AppRole } from '@/lib/auth';
import { COST_HEADS } from '@/lib/ledger/types';

/** Choices for enum fields. Mirrors the Postgres enums in supabase/migrations. Keep both in sync. */
export const ENUMS = {
  party_kind: ['vendor', 'client', 'worker', 'staff', 'other'],
  contract_type: ['item_rate', 'fixed'],
  money_account_kind: ['bank', 'owner_cash', 'supervisor_cash'],
  role: ['owner', 'office', 'supervisor'],
  cost_head: COST_HEADS,
  /** Not a database enum: whether the owner puts money in or takes it out. */
  owner_money: ['in', 'out'],
  /** Not a database enum: how a payment or receipt was made. Online and cheque use a bank; cash uses a cash account. */
  payment_method: ['online', 'cash', 'cheque'],
} as const;
export type EnumName = keyof typeof ENUMS;

/**
 * Where a reference field's choices come from. In a working firm, `moneyAccounts` lists that firm's banks
 * and common cash; `firmAccounts` lists only that firm's own banks and cash, for payments and receipts: firms never share money.
 */
export type RefSource =
  | 'firms' | 'sites' | 'clients' | 'supervisors' | 'vendors' | 'parties' | 'materials' | 'units' | 'gstRates' | 'tdsRates'
  | 'moneyAccounts' | 'firmAccounts';

/** One choice in a dropdown. Choices with a `group` come last, under that heading. */
export type Choice = { value: string; label: string; group?: string };

export type Field =
  | { name: string; kind: 'text' | 'email' | 'password' | 'percent' | 'date' | 'checkbox'; required?: boolean }
  | { name: string; kind: 'rupees'; required?: boolean; allowZero?: boolean }
  | { name: string; kind: 'enum'; enum: EnumName; required?: boolean }
  | { name: string; kind: 'ref' | 'multi'; ref: RefSource; required?: boolean }
  /** A bill's item lines: material, quantity, rate and GST rate per line, with the totals underneath. */
  | { name: string; kind: 'items'; required?: boolean };

export interface MasterDef {
  table: string;
  /** Office staff can view; only the owner can add or edit. */
  ownerOnly: boolean;
  /** Columns shown in the list, in order. */
  list: string[];
  fields: Field[];
}

const active: Field = { name: 'is_active', kind: 'checkbox' };

/** The master-data screens, keyed by URL slug (/masters/<slug>). */
export const MASTERS: Record<string, MasterDef> = {
  firms: {
    table: 'firms',
    ownerOnly: true,
    list: ['code', 'name'],
    fields: [
      { name: 'code', kind: 'text', required: true },
      { name: 'name', kind: 'text', required: true },
    ],
  },
  sites: {
    table: 'sites',
    ownerOnly: true,
    list: ['name', 'location', 'is_active'],
    fields: [{ name: 'name', kind: 'text', required: true }, { name: 'location', kind: 'text' }, active],
  },
  parties: {
    table: 'parties',
    ownerOnly: false,
    list: ['name', 'kind', 'phone', 'gst_number', 'is_active'],
    fields: [
      { name: 'kind', kind: 'enum', enum: 'party_kind', required: true },
      { name: 'name', kind: 'text', required: true },
      { name: 'phone', kind: 'text' },
      { name: 'gst_number', kind: 'text' },
      active,
    ],
  },
  'money-accounts': {
    table: 'money_accounts',
    ownerOnly: true,
    list: ['name', 'kind', 'firm_id', 'holder_user_id', 'is_active'],
    fields: [
      { name: 'kind', kind: 'enum', enum: 'money_account_kind', required: true },
      { name: 'name', kind: 'text', required: true },
      { name: 'firm_id', kind: 'ref', ref: 'firms' },
      { name: 'holder_user_id', kind: 'ref', ref: 'supervisors' },
      active,
    ],
  },
  materials: {
    table: 'materials',
    ownerOnly: false,
    list: ['name', 'unit_id', 'is_active'],
    fields: [{ name: 'name', kind: 'text', required: true }, { name: 'unit_id', kind: 'ref', ref: 'units' }, active],
  },
  units: {
    table: 'units',
    ownerOnly: false,
    list: ['name', 'is_active'],
    fields: [{ name: 'name', kind: 'text', required: true }, active],
  },
  'gst-rates': {
    table: 'gst_rates',
    ownerOnly: true,
    list: ['rate_bp', 'is_active'],
    fields: [{ name: 'rate_bp', kind: 'percent', required: true }, active],
  },
  'tds-rates': {
    table: 'tds_rates',
    ownerOnly: true,
    list: ['rate_bp', 'section', 'is_active'],
    fields: [{ name: 'rate_bp', kind: 'percent', required: true }, { name: 'section', kind: 'text' }, active],
  },
};

export function getMaster(slug: string): MasterDef | undefined {
  return Object.hasOwn(MASTERS, slug) ? MASTERS[slug] : undefined;
}

export const LOGIN_FIELDS: Field[] = [
  { name: 'email', kind: 'email', required: true },
  { name: 'password', kind: 'password', required: true },
];

const userFields: Field[] = [
  { name: 'full_name', kind: 'text', required: true },
  { name: 'role', kind: 'enum', enum: 'role', required: true },
  { name: 'firms', kind: 'multi', ref: 'firms' },
  { name: 'sites', kind: 'multi', ref: 'sites' },
];

export const NEW_USER_FIELDS: Field[] = [
  { name: 'email', kind: 'email', required: true },
  { name: 'password', kind: 'password', required: true },
  ...userFields,
];

/** Leaving the password empty keeps the current one. */
export const EDIT_USER_FIELDS: Field[] = [...userFields, active, { name: 'password', kind: 'password' }];

const amount: Field = { name: 'amount', kind: 'rupees', required: true };
const date: Field = { name: 'entry_date', kind: 'date', required: true };
const note: Field = { name: 'narration', kind: 'text' };
const reference: Field = { name: 'reference', kind: 'text' };
/** A bank or cash account field; `ref` says whether the other firm's banks are offered too (see RefSource). */
const account = (name: string, ref: RefSource = 'moneyAccounts'): Field => ({ name, kind: 'ref', ref, required: true });
const from = account('from_account_id');
const costHead: Field = { name: 'cost_head', kind: 'enum', enum: 'cost_head', required: true };
const client: Field = { name: 'client_id', kind: 'ref', ref: 'clients', required: true };
const payMethod: Field = { name: 'payment_method', kind: 'enum', enum: 'payment_method', required: true };
const items: Field = { name: 'items', kind: 'items', required: true };

/**
 * The money forms, keyed by URL slug (/entries/new/<slug>), in the order the "Add an entry" page shows them.
 * `roles` mirrors what the database lets each role post (app_assert_can_post); the database has the final say.
 * None asks for the firm: forms are filled in the working firm, the one chosen at the top right.
 */
export const ENTRY_FORMS = {
  'vendor-bill': {
    icon: '🧾',
    roles: ['owner', 'office'],
    fields: [
      // Details on the top row, then the items, then the notes and deductions in the foot.
      { name: 'vendor_id', kind: 'ref', ref: 'vendors', required: true },
      { name: 'bill_no', kind: 'text', required: true },
      date,
      { name: 'site_id', kind: 'ref', ref: 'sites', required: true },
      // Left empty, the type is material.
      { ...costHead, required: false },
      items,
      // Left empty, no TDS is deducted.
      { name: 'tds_rate', kind: 'ref', ref: 'tdsRates' },
      note,
    ],
  },
  'pay-vendor': {
    icon: '💸',
    roles: ['owner', 'office'],
    fields: [
      { name: 'vendor_id', kind: 'ref', ref: 'vendors', required: true },
      // Another firm's bank may pay this firm's bill: this firm then owes that one.
      payMethod, account('from_account_id', 'firmAccounts'), amount, date, reference, note,
    ],
  },
  'client-bill': {
    icon: '📄',
    roles: ['owner', 'office'],
    fields: [
      // Details on the top row (client, bill number, date), the site, then the items; the cuts sit in the foot.
      client,
      { name: 'bill_no', kind: 'text', required: true },
      date,
      { name: 'site_id', kind: 'ref', ref: 'sites', required: true },
      items,
      // Left empty, no TDS is deducted. Retention and deposit left empty mean none.
      { name: 'tds_rate', kind: 'ref', ref: 'tdsRates' },
      { name: 'retention', kind: 'rupees', allowZero: true },
      { name: 'security_deposit', kind: 'rupees', allowZero: true },
      note,
    ],
  },
  'client-receipt': {
    icon: '💰',
    roles: ['owner', 'office'],
    // The client's money lands in this firm's own bank or cash.
    fields: [client, payMethod, account('to_account_id', 'firmAccounts'), amount, date, reference, note],
  },
  'site-spend': {
    icon: '🛠️',
    roles: ['owner', 'supervisor'],
    fields: [
      from,
      { name: 'site_id', kind: 'ref', ref: 'sites', required: true },
      { name: 'material_id', kind: 'ref', ref: 'materials' },
      { ...costHead, required: false }, amount,
      { name: 'narration', kind: 'text', required: true },
      { name: 'paid_to_id', kind: 'ref', ref: 'parties' },
      date,
    ],
  },
  'day-close': {
    icon: '🧮',
    roles: ['owner', 'supervisor'],
    fields: [
      { name: 'account_id', kind: 'ref', ref: 'moneyAccounts', required: true },
      { name: 'counted', kind: 'rupees', required: true, allowZero: true },
      date,
    ],
  },
  'owner-money': {
    icon: '🏦',
    roles: ['owner'],
    fields: [
      { name: 'direction', kind: 'enum', enum: 'owner_money', required: true },
      { name: 'account_id', kind: 'ref', ref: 'moneyAccounts', required: true },
      amount, date, note,
    ],
  },
} satisfies Record<string, { icon: string; roles: AppRole[]; fields: Field[] }>;
export type EntryFormSlug = keyof typeof ENTRY_FORMS;

/**
 * Forms made for the working firm's own vendor or client. The others take their firm from the bank picked
 * (cash makes them common), as the posting rules always have.
 */
export const FIRM_FORMS: ReadonlySet<string> = new Set<EntryFormSlug>(['vendor-bill', 'pay-vendor', 'client-bill', 'client-receipt']);

export function getEntryForm(slug: string) {
  return Object.hasOwn(ENTRY_FORMS, slug) ? ENTRY_FORMS[slug as EntryFormSlug] : undefined;
}
