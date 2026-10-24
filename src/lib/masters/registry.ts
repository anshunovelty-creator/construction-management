import type { AppRole } from '@/lib/auth';
import { COST_HEADS } from '@/lib/ledger/types';

/** Choices for enum fields. Mirrors the Postgres enums in supabase/migrations. Keep both in sync. */
export const ENUMS = {
  party_kind: ['vendor', 'client', 'worker', 'staff', 'other'],
  contract_type: ['item_rate', 'fixed'],
  money_account_kind: ['bank', 'owner_cash', 'supervisor_cash'],
  role: ['owner', 'office', 'supervisor'],
  language: ['en', 'hi'],
  cost_head: COST_HEADS,
  /** Not a database enum: whether the owner puts money in or takes it out. */
  owner_money: ['in', 'out'],
} as const;
export type EnumName = keyof typeof ENUMS;

/** Where a reference field's choices come from. */
export type RefSource = 'firms' | 'sites' | 'clients' | 'supervisors' | 'vendors' | 'parties' | 'moneyAccounts' | 'workOrders' | 'materials';

export type Field =
  | { name: string; kind: 'text' | 'email' | 'password' | 'percent' | 'date' | 'checkbox'; required?: boolean }
  | { name: string; kind: 'rupees'; required?: boolean; allowZero?: boolean }
  | { name: string; kind: 'enum'; enum: EnumName; required?: boolean }
  | { name: string; kind: 'ref' | 'multi'; ref: RefSource; required?: boolean };

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
    list: ['name', 'kind', 'phone', 'is_active'],
    fields: [
      { name: 'kind', kind: 'enum', enum: 'party_kind', required: true },
      { name: 'name', kind: 'text', required: true },
      { name: 'phone', kind: 'text' },
      active,
    ],
  },
  'work-orders': {
    table: 'work_orders',
    ownerOnly: true,
    list: ['ref', 'firm_id', 'client_id', 'site_id', 'contract_type', 'is_active'],
    fields: [
      { name: 'firm_id', kind: 'ref', ref: 'firms', required: true },
      { name: 'client_id', kind: 'ref', ref: 'clients', required: true },
      { name: 'site_id', kind: 'ref', ref: 'sites', required: true },
      { name: 'ref', kind: 'text', required: true },
      { name: 'contract_type', kind: 'enum', enum: 'contract_type', required: true },
      { name: 'contract_value_paise', kind: 'rupees' },
      { name: 'tds_bp', kind: 'percent' },
      { name: 'retention_bp', kind: 'percent' },
      { name: 'security_deposit_bp', kind: 'percent' },
      { name: 'start_date', kind: 'date', required: true },
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
    list: ['name', 'is_active'],
    fields: [{ name: 'name', kind: 'text', required: true }, active],
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
  { name: 'language', kind: 'enum', enum: 'language', required: true },
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

export const LANGUAGE_FIELDS: Field[] = [{ name: 'language', kind: 'enum', enum: 'language', required: true }];

const amount: Field = { name: 'amount', kind: 'rupees', required: true };
const date: Field = { name: 'entry_date', kind: 'date', required: true };
const note: Field = { name: 'narration', kind: 'text' };
const reference: Field = { name: 'reference', kind: 'text' };
const from: Field = { name: 'from_account_id', kind: 'ref', ref: 'moneyAccounts', required: true };
const to: Field = { name: 'to_account_id', kind: 'ref', ref: 'moneyAccounts', required: true };
const costHead: Field = { name: 'cost_head', kind: 'enum', enum: 'cost_head', required: true };
const workOrder: Field = { name: 'work_order_id', kind: 'ref', ref: 'workOrders', required: true };

/**
 * The money forms, keyed by URL slug (/entries/new/<slug>), in the order the "Add an entry" page shows them.
 * `roles` mirrors what the database lets each role post (app_assert_can_post); the database has the final say.
 */
export const ENTRY_FORMS = {
  'vendor-bill': {
    icon: '🧾',
    roles: ['owner', 'office'],
    fields: [
      { name: 'firm_id', kind: 'ref', ref: 'firms', required: true },
      { name: 'vendor_id', kind: 'ref', ref: 'vendors', required: true },
      { name: 'site_id', kind: 'ref', ref: 'sites', required: true },
      { name: 'bill_no', kind: 'text', required: true },
      { name: 'material_id', kind: 'ref', ref: 'materials' },
      // Picking a material is enough: the type then defaults to material.
      { ...costHead, required: false }, amount, date, note,
    ],
  },
  'pay-vendor': {
    icon: '💸',
    roles: ['owner', 'office'],
    fields: [
      { name: 'vendor_id', kind: 'ref', ref: 'vendors', required: true },
      { name: 'firm_id', kind: 'ref', ref: 'firms', required: true },
      from, amount, date, reference, note,
    ],
  },
  'client-bill': {
    icon: '📄',
    roles: ['owner', 'office'],
    fields: [
      workOrder,
      { name: 'bill_no', kind: 'text', required: true },
      { name: 'gross', kind: 'rupees', required: true },
      { name: 'tds', kind: 'rupees', allowZero: true },
      { name: 'retention', kind: 'rupees', allowZero: true },
      { name: 'security_deposit', kind: 'rupees', allowZero: true },
      date, note,
    ],
  },
  'client-receipt': {
    icon: '💰',
    roles: ['owner', 'office'],
    fields: [workOrder, to, amount, date, reference, note],
  },
  'move-money': {
    icon: '🔁',
    roles: ['owner', 'office'],
    fields: [from, to, amount, date, reference, note],
  },
  'site-spend': {
    icon: '🛠️',
    roles: ['owner', 'supervisor'],
    fields: [
      from,
      { name: 'site_id', kind: 'ref', ref: 'sites', required: true },
      costHead, amount,
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

export function getEntryForm(slug: string) {
  return Object.hasOwn(ENTRY_FORMS, slug) ? ENTRY_FORMS[slug as EntryFormSlug] : undefined;
}
