'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form';
import { quantityToMilli } from '@/lib/ledger/bill-items';
import { requireProfile } from '@/lib/auth';
import { moneyAccountErrors, parseFields, submittedValues } from '@/lib/masters/parse';
import { getMaster, mayEdit } from '@/lib/masters/registry';
import { createAdminClient } from '@/lib/supabase/admin';
import { allowDelete } from '@/lib/supabase/env';
import { createClient } from '@/lib/supabase/server';
import type { MixLine, MixState } from './mixes/mix-form';

/** Adds (id = null) or edits a master row as the signed-in user. Row level security has the final say. */
export async function saveMaster(slug: string, id: string | null, _state: FormState, data: FormData): Promise<FormState> {
  const def = getMaster(slug);
  const profile = await requireProfile();
  if (!def || !mayEdit(def, profile.role)) return { errors: { _form: 'not_allowed' } };

  const values = submittedValues(data);
  const parsed = parseFields(def.fields, data);
  if (!parsed.ok) return { errors: parsed.errors, values };
  const broken = slug === 'money-accounts' ? moneyAccountErrors(parsed.values) : null;
  if (broken) return { errors: broken, values };

  const db = await createClient();
  const { error } = id
    ? await db.from(def.table).update(parsed.values as Record<string, unknown>).eq('id', id)
    : await db.from(def.table).insert(parsed.values as Record<string, unknown>);
  if (error) {
    const duplicate = error.code === '23505';
    return { errors: { _form: duplicate ? 'duplicate' : 'save_failed' }, detail: duplicate ? undefined : error.message, values };
  }
  revalidatePath('/', 'layout');
  redirect(`/masters/${slug}`);
}

/**
 * Testing only (ALLOW_DELETE=true): the owner deletes a Setup record for good. The API role has no delete
 * permission on purpose, so this uses the secret key. Records still in use (entries, work orders, accounts,
 * staff access) are refused by the database; the page says what uses them.
 */
export async function deleteMaster(slug: string, id: string): Promise<void> {
  const def = getMaster(slug);
  await requireProfile('owner');
  if (!def || !allowDelete()) redirect(`/masters/${slug}/${id}?error=not_allowed`);
  const { error } = await createAdminClient().from(def.table).delete().eq('id', id);
  if (error) {
    // details: 'Key (id)=(…) is still referenced from table "work_orders".'
    const usedBy = error.code === '23503' ? (error.details?.match(/from table "(\w+)"/)?.[1] ?? 'other') : '';
    redirect(`/masters/${slug}/${id}?error=${usedBy ? 'in_use' : 'save_failed'}&used=${usedBy}`);
  }
  revalidatePath('/', 'layout');
  redirect(`/masters/${slug}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Adds a material from the form being filled in (daily report, stock or assets arrived), so a material not on the list yet does
 * not mean a trip to Setup. Supervisors may add; changing materials stays in Setup.
 */
export async function addMaterial(name: string, unitId: string, kind: 'consumable' | 'asset' = 'consumable'):
  Promise<{ id: string; name: string } | { error: string }> {
  await requireProfile('owner', 'office', 'supervisor');
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return { error: 'need_name' };
  if ((unitId && !UUID.test(unitId)) || (kind !== 'consumable' && kind !== 'asset')) return { error: 'save_failed' };
  const db = await createClient();
  const { data, error } = await db.from('materials').insert({ name: clean, unit_id: unitId || null, item_kind: kind }).select('id, name').single();
  if (error) return { error: error.code === '23505' ? 'duplicate' : 'save_failed' };
  revalidatePath('/', 'layout');
  return data;
}

/**
 * Adds (id = null) or changes a combination work (PCC, RCC, plaster…): its name, its unit, and how much of each
 * material 1 unit of it takes. Its materials are saved again whole. Owner, office and supervisors keep this list.
 */
export async function saveMix(id: string | null, _state: MixState, data: FormData): Promise<MixState> {
  await requireProfile('owner', 'office', 'supervisor');
  const name = String(data.get('name') ?? '').trim().replace(/\s+/g, ' ');
  const unitId = String(data.get('unit_id') ?? '');
  if (!name) return { error: 'need_name' };
  if (unitId && !UUID.test(unitId)) return { error: 'save_failed' };
  let lines: MixLine[];
  try {
    lines = JSON.parse(String(data.get('lines') ?? '[]')) as MixLine[];
    if (!Array.isArray(lines)) throw new Error();
  } catch {
    return { error: 'save_failed' };
  }
  const items: { material_id: string; quantity: number; position: number }[] = [];
  for (const [i, line] of lines.entries()) {
    const quantity = (line.quantity ?? '').trim();
    if (!line.materialId && !quantity) continue;
    if (!UUID.test(line.materialId ?? '')) return { error: 'pick_material', line: i };
    if (items.some((x) => x.material_id === line.materialId)) return { error: 'twice', line: i };
    try {
      items.push({ material_id: line.materialId, quantity: quantityToMilli(quantity) / 1000, position: items.length });
    } catch {
      return { error: 'bad_quantity', line: i };
    }
  }
  if (items.length === 0) return { error: 'need_material' };

  const db = await createClient();
  const row = { name, unit_id: unitId || null, is_active: id ? data.get('is_active') === 'on' : true };
  const saved = id
    ? await db.from('mixes').update(row).eq('id', id).select('id').single()
    : await db.from('mixes').insert(row).select('id').single();
  if (saved.error) return saved.error.code === '23505' ? { error: 'duplicate' } : { error: 'save_failed', detail: saved.error.message };
  // ponytail: two steps, not one transaction; if the second fails the work keeps no materials until it is saved again.
  const mixId = saved.data.id as string;
  const cleared = await db.from('mix_items').delete().eq('mix_id', mixId);
  const added = cleared.error ?? (await db.from('mix_items').insert(items.map((x) => ({ ...x, mix_id: mixId })))).error;
  if (added) return { error: 'save_failed', detail: added.message };
  revalidatePath('/masters/mixes');
  revalidatePath('/report');
  redirect('/masters/mixes');
}
