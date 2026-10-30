'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { quantityToMilli } from '@/lib/ledger/bill-items';
import { createClient } from '@/lib/supabase/server';

const back = (siteId: string, date: string, error?: string) =>
  redirect(`/report?site=${siteId}&date=${date}${error ? `&error=${encodeURIComponent(error)}` : ''}`);

/** The material lines typed on a site's daily report. Blank lines are skipped; one bad line saves nothing. */
export async function addMaterialUse(siteId: string, date: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office', 'supervisor');
  const materials = data.getAll('material').map(String);
  const quantities = data.getAll('quantity').map(String);
  const remarks = data.getAll('remark').map(String);
  const rows = [];
  for (const [i, materialId] of materials.entries()) {
    const quantity = (quantities[i] ?? '').trim();
    if (!materialId && !quantity) continue;
    if (!materialId) back(siteId, date, 'pick_material');
    let milli: number;
    try {
      milli = quantityToMilli(quantity);
    } catch {
      return back(siteId, date, 'bad_quantity');
    }
    rows.push({ site_id: siteId, use_date: date, material_id: materialId, quantity: milli / 1000, remark: (remarks[i] ?? '').trim() });
  }
  if (rows.length === 0) back(siteId, date, 'nothing');
  const { error } = await (await createClient()).from('material_use').insert(rows);
  if (error) back(siteId, date, error.message);
  revalidatePath('/report');
  revalidatePath('/stock');
  back(siteId, date);
}

/** Takes a wrong line off the report; the database allows it for the office, or its supervisor on the same day. */
export async function removeMaterialUse(id: string, siteId: string, date: string): Promise<void> {
  await requireProfile('owner', 'office', 'supervisor');
  const { data, error } = await (await createClient()).from('material_use').delete().eq('id', id).select('id');
  if (error || !data?.length) back(siteId, date, error?.message ?? 'not_removed');
  revalidatePath('/report');
  revalidatePath('/stock');
  back(siteId, date);
}
