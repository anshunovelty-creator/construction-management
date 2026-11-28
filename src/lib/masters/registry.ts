import type { AppRole } from '@/lib/auth';
import { IN_REASONS, OUT_REASONS } from '@/lib/ledger/posting/other';
import { COST_HEADS } from '@/lib/ledger/types';
import type { IconName } from '@/components/icons';

/** Choices for enum fields. Mirrors the Postgres enums in supabase/migrations. Keep both in sync. */
export const ENUMS = {
  party_kind: ['vendor', 'client', 'worker', 'staff', 'other', 'lender'],
  contract_type: ['item_rate', 'fixed'],
  /** Cash with a person (supervisor_cash) is no longer offered (owner decision 2026-11-24): only Bank and Cash. */
  money_account_kind: ['bank', 'owner_cash'],
  role: ['owner', 'office', 'supervisor', 'labour'],
  cost_head: COST_HEADS,
  /** Not a database enum: whether the owner puts money in or takes it out. */
  owner_money: ['in', 'out'],
  /** Not a database enum: whether money not yet known came in or went out. */
  in_out: ['in', 'out'],
  /** Not a database enum: what other money in or out was for (see REASONS). */
  money_reason: [...IN_REASONS, ...OUT_REASONS],
  /** Not a database enum: how a payment or receipt was made. Online and cheque use a bank; cash uses a cash account. */
  payment_method: ['online', 'cash', 'cheque'],
  /** How a unit is measured on the daily report: see src/lib/work.ts. */
  unit_measure: ['quantity', 'length', 'area', 'volume', 'factors'],
  /** The party kinds kept on the Workers and staff list: a worker is paid by the hour, staff a fixed salary per month. */
  worker_kind: ['worker', 'staff'],
  /** The same list for a supervisor, who does not see staff: what they are paid is not theirs to see. */
  worker_only: ['worker'],
  /** The kinds added on the Parties screen; workers and staff have their own screen. */
  party_main: ['vendor', 'client', 'lender'],
  /** Not a database enum (a checked text column): for information only, pay is unaffected. */
  skill_level: ['skilled', 'unskilled'],
  /** Not a database enum (a checked text column): what a material is bought as. See ITEM_KINDS. */
  item_kind: ['consumable', 'asset', 'rented'],
} as const;
export type EnumName = keyof typeof ENUMS;

/**
 * Where a reference field's choices come from. In a working firm, `moneyAccounts` lists that firm's own banks and cash.
 */
export type RefSource =
  | 'firms' | 'sites' | 'clients' | 'supervisors' | 'vendors' | 'parties' | 'materials' | 'units' | 'gstRates' | 'tdsRates'
  | 'moneyAccounts';

/** One choice in a dropdown. Choices with a `group` come last, under that heading. */
/** `kind`: a money account's kind (bank, owner_cash, ...), so a payment form can list only accounts that fit how it was paid. */
export type Choice = { value: string; label: string; group?: string; kind?: string };

export type Field =
  | { name: string; kind: 'text' | 'email' | 'password' | 'percent' | 'date' | 'checkbox'; required?: boolean }
  | { name: string; kind: 'rupees'; required?: boolean; allowZero?: boolean }
  | { name: string; kind: 'enum'; enum: EnumName; required?: boolean }
  | { name: string; kind: 'ref' | 'multi'; ref: RefSource; required?: boolean };

/** Asked only when a bank or cash account is added: what it holds already. Posted as its opening balance, not a column. */
export const OPENING_FIELDS: Field[] = [
  { name: 'opening_balance', kind: 'rupees', allowZero: true },
  { name: 'opening_date', kind: 'date' },
];

export interface MasterDef {
  table: string;
  /** Office staff can view; only the owner can add or edit. */
  ownerOnly: boolean;
  /** Supervisors keep this list too (owner decision 2026-11-03); they see no other Setup screen. */
  supervisor?: boolean;
  /** Columns shown in the list, in order. */
  list: string[];
  fields: Field[];
  /** Only these party kinds: a second view of the parties table. */
  kinds?: readonly string[];
}

const active: Field = { name: 'is_active', kind: 'checkbox' };

/** The master-data screens, keyed by URL slug (/masters/<slug>). */
export const MASTERS: Record<string, MasterDef> = {
  firms: {
    table: 'firms',
    ownerOnly: true,
    list: ['code', 'name', 'runs_labour'],
    fields: [
      { name: 'code', kind: 'text', required: true },
      { name: 'name', kind: 'text', required: true },
      // One firm (the database checks): Ansari Enterprise.
      { name: 'runs_labour', kind: 'checkbox' },
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
    // Old "other" parties stay listed so they can still be found and changed to a party or client.
    kinds: ['vendor', 'client', 'other', 'lender'],
    list: ['name', 'kind', 'phone', 'gst_number', 'is_active'],
    fields: [
      { name: 'kind', kind: 'enum', enum: 'party_main', required: true },
      { name: 'name', kind: 'text', required: true },
      { name: 'phone', kind: 'text' },
      { name: 'gst_number', kind: 'text' },
      active,
    ],
  },
  workers: {
    table: 'parties',
    ownerOnly: false,
    supervisor: true,
    kinds: ENUMS.worker_kind,
    list: ['name', 'kind', 'skill_level', 'skill', 'rate_paise', 'site_id', 'phone', 'is_active'],
    fields: [
      { name: 'kind', kind: 'enum', enum: 'worker_kind', required: true },
      { name: 'name', kind: 'text', required: true },
      { name: 'skill_level', kind: 'enum', enum: 'skill_level' },
      { name: 'skill', kind: 'text' },
      { name: 'rate_paise', kind: 'rupees', required: true },
      { name: 'site_id', kind: 'ref', ref: 'sites' },
      { name: 'phone', kind: 'text' },
      // Staff: the day their salary starts. Left empty, the day they are added here.
      { name: 'pay_from', kind: 'date' },
      active,
    ],
  },
  'money-accounts': {
    table: 'money_accounts',
    ownerOnly: true,
    list: ['name', 'kind', 'firm_id', 'is_active'],
    fields: [
      { name: 'kind', kind: 'enum', enum: 'money_account_kind', required: true },
      { name: 'name', kind: 'text', required: true },
      { name: 'firm_id', kind: 'ref', ref: 'firms' },
      active,
    ],
  },
  materials: {
    table: 'materials',
    ownerOnly: false,
    supervisor: true,
    list: ['name', 'unit_id', 'item_kind', 'is_active'],
    fields: [
      { name: 'name', kind: 'text', required: true }, { name: 'unit_id', kind: 'ref', ref: 'units' },
      { name: 'item_kind', kind: 'enum', enum: 'item_kind', required: true }, active,
    ],
  },
  units: {
    table: 'units',
    ownerOnly: false,
    supervisor: true,
    list: ['name', 'measure', 'is_active'],
    fields: [{ name: 'name', kind: 'text', required: true }, { name: 'measure', kind: 'enum', enum: 'unit_measure', required: true }, active],
  },
  'gst-rates': {
    table: 'gst_rates',
    ownerOnly: true,
    list: ['rate_bp', 'is_active'],
    fields: [{ name: 'rate_bp', kind: 'percent', required: true }, active],
  },
  /** PF cut from salary, each rate counting from the month of its date on (see pfRate in src/lib/wages.ts). */
  'pf-rates': {
    table: 'pf_rates',
    ownerOnly: false,
    list: ['rate_bp', 'from_date'],
    fields: [{ name: 'rate_bp', kind: 'percent', required: true }, { name: 'from_date', kind: 'date', required: true }],
  },
  'tds-rates': {
    table: 'tds_rates',
    ownerOnly: true,
    list: ['rate_bp', 'section', 'is_active'],
    fields: [{ name: 'rate_bp', kind: 'percent', required: true }, { name: 'section', kind: 'text' }, active],
  },
};

/** Whether this person may open a Setup screen, and change what is on it. The database has the final say. */
export const mayView = (def: MasterDef, role: AppRole) => role !== 'supervisor' || Boolean(def.supervisor);
export const mayEdit = (def: MasterDef, role: AppRole) =>
  role === 'owner' || (role === 'office' ? !def.ownerOnly : Boolean(def.supervisor));

/** A Setup screen as this person has it: a supervisor keeps workers but not staff, whose salaries they do not see. */
export function getMaster(slug: string, role?: AppRole): MasterDef | undefined {
  const def = Object.hasOwn(MASTERS, slug) ? MASTERS[slug] : undefined;
  if (slug !== 'workers' || role !== 'supervisor' || !def) return def;
  return {
    ...def, kinds: ENUMS.worker_only,
    fields: def.fields.filter((f) => f.name !== 'pay_from').map((f) => (f.name === 'kind' ? { name: 'kind', kind: 'enum', enum: 'worker_only', required: true } : f)),
  };
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
/** What the bank kept on top of the money (owner decision 2026-11-28); left empty, none. */
const charges: Field = { name: 'charges', kind: 'rupees' };
const date: Field = { name: 'entry_date', kind: 'date', required: true };
const note: Field = { name: 'narration', kind: 'text' };
const reference: Field = { name: 'reference', kind: 'text' };
/** A bank or cash account of the working firm. */
const account = (name: string): Field => ({ name, kind: 'ref', ref: 'moneyAccounts', required: true });
const from = account('from_account_id');
const costHead: Field = { name: 'cost_head', kind: 'enum', enum: 'cost_head', required: true };
const client: Field = { name: 'client_id', kind: 'ref', ref: 'clients', required: true };
// Optional: the account already says bank or cash. The vendor page's Pay card and the payment sheets have no such box.
const payMethod: Field = { name: 'payment_method', kind: 'enum', enum: 'payment_method' };
// A bill is money only (owner decision 2026-11-03): the amount before GST and one GST rate; left empty, no GST.
const billAmount: Field[] = [{ name: 'amount', kind: 'rupees', required: true }, { name: 'gst_rate', kind: 'ref', ref: 'gstRates' }];

/**
 * The money forms, keyed by URL slug (/entries/new/<slug>), in the order the "Add an entry" page shows them.
 * `roles` is who is offered each form. Supervisors are offered none: what they spend goes on the daily report (owner
 * decision 2026-11-03), though the database (app_assert_can_post) would still take their site spend.
 * None asks for the firm: forms are filled in the working firm, the one chosen at the top right.
 */
export const ENTRY_FORMS = {
  'vendor-bill': {
    icon: 'bill' as IconName,
    roles: ['owner', 'office'],
    fields: [
      // Details on the top row, then the amount, then the notes and deductions in the foot.
      { name: 'vendor_id', kind: 'ref', ref: 'vendors', required: true },
      { name: 'bill_no', kind: 'text', required: true },
      date,
      { name: 'site_id', kind: 'ref', ref: 'sites', required: true },
      ...billAmount,
      // Left empty, no TDS is deducted.
      { name: 'tds_rate', kind: 'ref', ref: 'tdsRates' },
      note,
    ],
  },
  'pay-vendor': {
    icon: 'payOut' as IconName,
    roles: ['owner', 'office'],
    fields: [
      { name: 'vendor_id', kind: 'ref', ref: 'vendors', required: true },
      payMethod, from, amount, charges, date, reference, note,
    ],
  },
  'client-bill': {
    icon: 'invoice' as IconName,
    roles: ['owner', 'office'],
    fields: [
      // Details on the top row (client, bill number, date), the site, then the amount; the cuts sit in the foot.
      client,
      { name: 'bill_no', kind: 'text', required: true },
      date,
      { name: 'site_id', kind: 'ref', ref: 'sites', required: true },
      ...billAmount,
      // Left empty, no TDS is deducted. Retention and deposit left empty mean none.
      { name: 'tds_rate', kind: 'ref', ref: 'tdsRates' },
      { name: 'retention', kind: 'rupees', allowZero: true },
      { name: 'security_deposit', kind: 'rupees', allowZero: true },
      note,
    ],
  },
  'client-receipt': {
    icon: 'receive' as IconName,
    roles: ['owner', 'office'],
    // The client's money lands in this firm's own bank or cash.
    fields: [client, payMethod, account('to_account_id'), amount, date, reference, note],
  },
  'site-spend': {
    icon: 'tool' as IconName,
    roles: ['owner'],
    fields: [
      from,
      { name: 'site_id', kind: 'ref', ref: 'sites', required: true },
      { name: 'material_id', kind: 'ref', ref: 'materials' },
      { ...costHead, required: false }, amount, charges,
      { name: 'narration', kind: 'text', required: true },
      { name: 'paid_to_id', kind: 'ref', ref: 'parties' },
      date,
    ],
  },
  'move-money': {
    icon: 'arrowRight' as IconName,
    roles: ['owner', 'office'],
    fields: [from, account('to_account_id'), amount, charges, date, reference, note],
  },
  'not-yet-known': {
    icon: 'calc' as IconName,
    roles: ['owner', 'office'],
    fields: [
      { name: 'direction', kind: 'enum', enum: 'in_out', required: true },
      account('account_id'), amount, date, reference,
      { name: 'narration', kind: 'text', required: true },
    ],
  },
  'other-money': {
    icon: 'bank' as IconName,
    roles: ['owner', 'office'],
    fields: [
      { name: 'reason', kind: 'enum', enum: 'money_reason', required: true },
      account('account_id'), amount, charges, date,
      { name: 'person_id', kind: 'ref', ref: 'parties' },
      { name: 'month', kind: 'text' },
      reference, note,
    ],
  },
  'owner-money': {
    icon: 'bank' as IconName,
    roles: ['owner'],
    fields: [
      { name: 'direction', kind: 'enum', enum: 'owner_money', required: true },
      account('account_id'),
      amount, charges, date, note,
    ],
  },
} satisfies Record<string, { icon: IconName; roles: AppRole[]; fields: Field[] }>;
export type EntryFormSlug = keyof typeof ENTRY_FORMS;

/**
 * Forms made for the working firm's own vendor or client. The others take their firm from the bank or cash account picked.
 */
export const FIRM_FORMS: ReadonlySet<string> = new Set<EntryFormSlug>(['vendor-bill', 'pay-vendor', 'client-bill', 'client-receipt']);

export function getEntryForm(slug: string) {
  return Object.hasOwn(ENTRY_FORMS, slug) ? ENTRY_FORMS[slug as EntryFormSlug] : undefined;
}
