import type { PopupPerson } from '@/components/money-popup';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;

/** One live bankbook line of money borrowed (above zero) or returned (below), from view `money_rows`. */
export interface LoanRow {
  entry_id: string;
  serial: string;
  entry_date: string;
  /** The lender, named on the entry; null for loans typed before lenders were kept. */
  party_id: string | null;
  money_account_id: string;
  reference: string;
  narration: string;
  amount_paise: number | string;
}

/** A lender of one firm, with what was borrowed, returned and is left to return (below zero: returned extra). */
export interface Lender extends PopupPerson { borrowed: number; returned: number; active: boolean }

export async function loadLoans(db: Db, firmId: string): Promise<LoanRow[]> {
  // ponytail: the first 1000 loan lines of a firm; page through them if one ever has more.
  const { data, error } = await db.from('money_rows')
    .select('entry_id, serial, entry_date, party_id, money_account_id, reference, narration, amount_paise')
    .eq('firm_id', firmId).eq('reason', 'loan').order('entry_date').order('created_at').limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as LoanRow[];
}

/** Every active lender, and anyone else this firm has loan lines with; most left to return first, then A to Z. */
export function lendersOf(rows: LoanRow[], people: { id: string; name: string; is_active: boolean }[]): Lender[] {
  const of = new Map<string, Lender>();
  const make = (id: string, name: string, active: boolean) => ({ id, name, active, borrowed: 0, returned: 0, left: 0 });
  for (const p of people) if (p.is_active) of.set(p.id, make(p.id, p.name, true));
  for (const r of rows) {
    const id = r.party_id ?? '';
    const l = of.get(id) ?? make(id, people.find((p) => p.id === id)?.name ?? '', false);
    of.set(id, l);
    const amount = Number(r.amount_paise);
    if (amount > 0) l.borrowed += amount;
    else l.returned -= amount;
    l.left = l.borrowed - l.returned;
  }
  return [...of.values()].sort((a, b) => Math.max(b.left, 0) - Math.max(a.left, 0) || a.name.localeCompare(b.name));
}

export async function loadLenders(db: Db, firmId: string): Promise<Lender[]> {
  const [rows, { data: people, error }] = await Promise.all([
    loadLoans(db, firmId),
    db.from('parties').select('id, name, is_active').eq('kind', 'lender').order('name'),
  ]);
  if (error) throw new Error(error.message);
  return lendersOf(rows, people ?? []);
}

/** The lenders a pop-up may name: active ones with a name. */
export const pickable = (lenders: Lender[]): PopupPerson[] =>
  lenders.filter((l) => l.id && l.active).map(({ id, name, left }) => ({ id, name, left }));
