import type { ListPerson } from '@/components/pay-list';
import type { PopupAccount, PopupPerson } from '@/components/money-popup';
import type { Names } from '@/lib/ledger/plain';
import type { createClient } from '@/lib/supabase/server';
import { loadFirmClients, loadFirmParties } from '../party/shared';

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
