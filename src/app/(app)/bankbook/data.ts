import type { ListPerson } from '@/components/pay-list';
import type { PopupAccount, PopupPerson } from '@/components/money-popup';
import type { Names } from '@/lib/ledger/plain';
import type { createClient } from '@/lib/supabase/server';
import { taxDue } from '@/lib/tax';
import { salaryLedger } from '@/lib/wages';
import { allRows, loadFamilies } from '../labour/data';
import { loadFirmClients, loadFirmParties } from '../party/shared';
import { loadSalaryPeople } from '../salary/data';

type Db = Awaited<ReturnType<typeof createClient>>;

export interface Account extends PopupAccount { firm_id: string | null; is_active: boolean }

/** One live entry in an account's bankbook, with the balance after it (view `money_rows`). */
export interface MoneyRow {
  money_account_id: string;
  firm_id: string | null;
  entry_id: string;
  serial: string;
  entry_type: string;
  entry_date: string;
  party_id: string | null;
  reference: string;
  narration: string;
  amount_paise: number | string;
  balance_paise: number | string;
  other_account_id: string | null;
  /** The other of our firms, when the money crossed to it. */
  counter_firm_id: string | null;
  /** The other account of the entry and what for, e.g. firm_cost_office. */
  reason: string | null;
  /** A bank line: the day the bank had it; null while waiting (a cheque not cleared yet). */
  cleared_on: string | null;
  site_id: string | null;
}

/** The bank and cash accounts the person may see, with what the books say each holds. One switched off shows only while it holds money. */
export async function loadAccounts(db: Db): Promise<Account[]> {
  const [{ data: accounts, error }, { data: balances }] = await Promise.all([
    db.from('money_accounts').select('id, name, kind, firm_id, is_active').order('name'),
    db.from('balances').select('money_account_id, amount_paise').eq('account', 'money'),
  ]);
  if (error) throw new Error(error.message);
  const held = new Map<string, number>();
  for (const b of balances ?? []) held.set(b.money_account_id as string, (held.get(b.money_account_id as string) ?? 0) + Number(b.amount_paise));
  return (accounts ?? []).map((a) => ({ ...a, balance: held.get(a.id) ?? 0 })).filter((a) => a.is_active || a.balance !== 0) as Account[];
}

/** Who money comes from and goes to in a firm, with what is left: every client and party, as one may have no entry yet. */
export async function loadPeople(db: Db, firmId: string): Promise<Record<'in' | 'out', PopupPerson[]>> {
  const [clients, parties, { data: all }] = await Promise.all([
    loadFirmClients(db, firmId),
    loadFirmParties(db, firmId),
    db.from('parties').select('id, name, kind').in('kind', ['client', 'vendor']).eq('is_active', true).order('name'),
  ]);
  const left = new Map([...clients, ...parties].map((p) => [p.id, p.f.balance]));
  const of = (kind: string) => (all ?? []).filter((p) => p.kind === kind)
    .map((p) => ({ id: p.id as string, name: p.name as string, left: left.get(p.id) ?? 0 }));
  return { in: of('client'), out: of('vendor') };
}

/**
 * Everyone a firm pays and receives from, in full: each active party and client, and anyone switched off who still has
 * something left. Most left first, then those with nothing left or extra, A to Z.
 */
export async function loadPayList(db: Db, firmId: string): Promise<Record<'party' | 'client', ListPerson[]>> {
  const [clients, parties, { data: all }] = await Promise.all([
    loadFirmClients(db, firmId),
    loadFirmParties(db, firmId),
    db.from('parties').select('id, name, kind').in('kind', ['client', 'vendor']).eq('is_active', true),
  ]);
  const list = (lines: typeof parties, kind: string): ListPerson[] => {
    const people = new Map<string, ListPerson>();
    const active = new Set<string>();
    for (const p of all ?? []) if (p.kind === kind) { active.add(p.id); people.set(p.id, { id: p.id, name: p.name, total: 0, done: 0, left: 0, last: null }); }
    for (const { id, name, f } of lines) {
      if (active.has(id) || f.balance !== 0) people.set(id, { id, name, total: f.total, done: f.paid, left: f.balance, last: f.lastPayment });
    }
    return [...people.values()].sort((a, b) => Math.max(b.left, 0) - Math.max(a.left, 0) || a.name.localeCompare(b.name));
  };
  return { party: list(parties, 'vendor'), client: list(clients, 'client') };
}

/** What a firm has to pay besides its parties. Salaries and PF are of all firms together, as a worker belongs to no one firm. */
export async function loadOtherDues(db: Db, firmId: string, today: string): Promise<Record<'salary' | 'wages' | 'gst' | 'tds' | 'pf', number>> {
  const month = today.slice(0, 7);
  const mine: [string, string] = ['firm_id', firmId];
  const [gstRows, tdsRows, { data: taxes }, { data: pfPaid }, people, families] = await Promise.all([
    allRows<{ entry_type: string; entry_date: string; gst_paise: number | string }>(db, 'gst_rows', ['entry_date', 'entry_id'], mine),
    allRows<{ entry_type: string; entry_date: string; tds_paise: number | string }>(db, 'tds_rows', ['entry_date', 'entry_id'], mine),
    db.from('tax_rows').select('account, amount_paise').eq('firm_id', firmId),
    db.from('tax_rows').select('amount_paise').eq('account', 'pf_paid'),
    loadSalaryPeople(db, today), loadFamilies(db),
  ]);
  const sum = (rows: { amount_paise: number | string }[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.amount_paise), 0);
  const paid = (account: string) => sum((taxes ?? []).filter((x) => x.account === account));
  const ledgers = people.map((p) => salaryLedger(p.person).filter((m) => m.month <= month));
  return {
    salary: ledgers.reduce((s, l) => s + Math.max(l.at(-1)?.balance ?? 0, 0), 0),
    wages: families.reduce((s, f) => s + Math.max(f.ledger.find((m) => m.month === month)?.balance ?? f.balance, 0), 0),
    gst: taxDue(gstRows.map((r) => ({ month: r.entry_date.slice(0, 7), amount: Number(r.gst_paise) * (r.entry_type === 'client_bill' ? 1 : -1) })), paid('gst_paid'), month),
    tds: taxDue(tdsRows.filter((r) => r.entry_type === 'vendor_bill').map((r) => ({ month: r.entry_date.slice(0, 7), amount: Number(r.tds_paise) })), paid('tds_paid'), month),
    pf: Math.max(ledgers.flat().reduce((s, m) => s + m.pf, 0) - sum(pfPaid), 0),
  };
}

export interface Unpaid {
  kind: 'cost' | 'service';
  id: string;
  date: string;
  /** The site of a cost, or the machine of a service. */
  placeId: string;
  place: string;
  what: string;
  head?: string;
  amount: number;
  /** It came on a party's bill, so it is paid there. */
  onBill: boolean;
}

/** Costs typed as not paid yet: other costs on the daily reports, and machine services. The newest first. */
export async function loadUnpaid(db: Db): Promise<Unpaid[]> {
  // ponytail: the newest 1000 of each; page through them if a business ever leaves that many unpaid.
  const [costs, services] = await Promise.all([
    db.from('other_cost').select('id, work_date, description, cost_head, amount_paise, on_bill, site:sites(id, name)').is('entry_id', null).gt('amount_paise', 0)
      .order('work_date', { ascending: false }).limit(1000)
      .returns<{ id: string; work_date: string; description: string; cost_head: string; amount_paise: number | string; on_bill: boolean | null; site: { id: string; name: string } | null }[]>(),
    db.from('machine_services').select('id, service_date, note, cost_paise, on_bill, machine:machines(id, name)').is('entry_id', null).gt('cost_paise', 0)
      .order('service_date', { ascending: false }).limit(1000)
      .returns<{ id: string; service_date: string; note: string; cost_paise: number | string; on_bill: boolean | null; machine: { id: string; name: string } | null }[]>(),
  ]);
  const error = costs.error ?? services.error;
  if (error) throw new Error(error.message);
  return [
    ...(costs.data ?? []).map((r) => ({ kind: 'cost' as const, id: r.id, date: r.work_date, placeId: r.site?.id ?? '', place: r.site?.name ?? '', what: r.description, head: r.cost_head, amount: Number(r.amount_paise), onBill: r.on_bill === true })),
    ...(services.data ?? []).map((r) => ({ kind: 'service' as const, id: r.id, date: r.service_date, placeId: r.machine?.id ?? '', place: r.machine?.name ?? '', what: r.note, amount: Number(r.cost_paise), onBill: r.on_bill === true })),
  ].sort((a, b) => b.date.localeCompare(a.date));
}

export interface BankMatch { money_account_id: string; statement_date: string; balance_paise: number | string; expected_paise: number | string }

/** Every line of an account's bankbook: the database hands back at most 1000 at a time. */
export async function allMoneyRows(db: Db, accountId: string): Promise<MoneyRow[]> {
  const rows: MoneyRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('money_rows').select('*').eq('money_account_id', accountId).order('position').range(from, from + 999).returns<MoneyRow[]>();
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

type T = (key: string) => string;

/** Where a line's money came from or went, in words. */
export function lineName(r: MoneyRow, names: Names, t: T): string {
  if (r.entry_type === 'opening') return t('ledger.openingBalance');
  if (r.entry_type === 'not_yet_known') return t('entryTypes.not_yet_known.title');
  if (r.entry_type === 'owner_capital' || r.entry_type === 'owner_drawing') return t('bankbook.owner');
  if (r.entry_type === 'wages_paid') return t('bankbook.people');
  if (r.entry_type === 'cash_close_difference') return t('entryTypes.cash_close_difference.title');
  if (r.reason && (r.entry_type === 'other_in' || r.entry_type === 'other_out') && !r.party_id) return t(`bankbook.reasons.${r.reason}`);
  if (r.party_id) return names.parties.get(r.party_id) ?? '';
  if (r.counter_firm_id) return names.firms.get(r.counter_firm_id) ?? '';
  if (r.entry_type === 'cash_transfer') return (r.other_account_id && names.accounts.get(r.other_account_id)) || t('bankbook.otherAccount');
  return (r.site_id && names.sites.get(r.site_id)) || '';
}
