import { createClient } from '@/lib/supabase/server';

/** Where a deleted record came from, as `app_bin_delete` knows it. Firms are not here: they are never deleted. */
export type BinKind = 'sites' | 'parties' | 'workers' | 'money-accounts' | 'materials' | 'units' | 'gst-rates' | 'tds-rates'
  | 'labour-workers' | 'machines' | 'mixes';

/** Why a delete did not happen: `in_use` comes with the table still using the record. */
export type BinRefusal = { error: 'in_use'; used: string } | { error: 'has_months' | 'not_allowed' | 'not_found' | 'save_failed' };

/**
 * Moves a record into the recycle bin as the person signed in, so the change log names them. Returns why not, or null.
 * The database refuses anything still in use (foreign key error 23503, whose details name the table).
 */
export async function moveToBin(kind: BinKind, id: string): Promise<BinRefusal | null> {
  const { error } = await (await createClient()).rpc('app_bin_delete', { p_kind: kind, p_id: id });
  if (!error) return null;
  if (error.code === '23503') return { error: 'in_use', used: error.details?.match(/from table "(\w+)"/)?.[1] ?? 'other' };
  if (error.message === 'has_months' || error.message === 'not_allowed' || error.message === 'not_found') return { error: error.message };
  return { error: 'save_failed' };
}

/** The query string a change page shows a refused delete with. */
export const refusalQuery = (r: BinRefusal) => (r.error === 'in_use' ? `error=in_use&used=${r.used}` : `error=${r.error}`);
