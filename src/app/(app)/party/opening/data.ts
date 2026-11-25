import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;

export interface Opening { entry_id: string; serial: string; entry_date: string; amount: number }

/** The opening balance of a party or client in a firm: above zero still to pay (or to come), below zero extra. */
export async function loadOpenings(db: Db, firmId: string, partyId: string, client: boolean): Promise<Opening[]> {
  const { data, error } = client
    ? await db.from('client_rows').select('entry_id, serial, entry_date, amount:receivable_paise').eq('firm_id', firmId).eq('party_id', partyId).eq('entry_type', 'opening')
    : await db.from('party_rows').select('entry_id, serial, entry_date, amount:amount_paise').eq('firm_id', firmId).eq('party_id', partyId).eq('entry_type', 'opening');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })) as Opening[];
}
