'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { quantityToMilli } from '@/lib/ledger/bill-items';
import { createClient } from '@/lib/supabase/server';
import { heldAt } from './held';

const back = (error?: string): never => redirect(`/assets?tab=moves${error ? `&error=${error}` : ''}`);

/** Takes assets from one site to another; no more than that site holds. Supervisors from their own sites (the database checks). */
export async function moveAsset(data: FormData): Promise<void> {
  await requireProfile();
  const v = (name: string) => String(data.get(name) ?? '').trim();
  const [material, from, to, date] = [v('material_id'), v('from_site_id'), v('to_site_id'), v('move_date')];
  if (!material || !from || !to) back('pick_all');
  if (from === to) back('same_site');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) back('invalid_date');
  let milli = 0;
  try {
    milli = quantityToMilli(v('quantity'));
  } catch {
    back('bad_quantity');
  }
  const db = await createClient();
  const [{ data: bought }, { data: moves }] = await Promise.all([
    db.from('asset_in_rows').select('material_id, site_id, quantity').eq('material_id', material),
    db.from('asset_moves').select('material_id, from_site_id, to_site_id, quantity').eq('material_id', material),
  ]);
  if (milli / 1000 > heldAt(bought ?? [], moves ?? [], material, from) + 1e-9) back('not_enough');
  const { error } = await db.from('asset_moves').insert({
    material_id: material, from_site_id: from, to_site_id: to, quantity: milli / 1000, move_date: date, note: v('note'),
  });
  if (error) back('not_saved');
  revalidatePath('/assets');
  back();
}

/** Takes a move typed wrong off the list: the office any move, a supervisor their own. */
export async function removeMove(id: string): Promise<void> {
  await requireProfile();
  const { data, error } = await (await createClient()).from('asset_moves').delete().eq('id', id).select('id');
  if (error || !data?.length) back('not_removed');
  revalidatePath('/assets');
  back();
}
