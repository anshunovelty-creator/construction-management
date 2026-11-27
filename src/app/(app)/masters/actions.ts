'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form';
import { quantityToMilli } from '@/lib/ledger/bill-items';
import { requireProfile } from '@/lib/auth';
import { moneyAccountErrors, parseFields, submittedValues } from '@/lib/masters/parse';
import { getMaster, mayEdit, OPENING_FIELDS } from '@/lib/masters/registry';
import { openingMoneyBalance } from '@/lib/ledger/posting/opening';
import { todayInIndia } from '../entries/data';
import { moveToBin, refusalQuery, type BinKind } from '@/lib/bin';
import { sameName, TYPE_TO_DELETE } from '@/lib/delete';
import { createClient } from '@/lib/supabase/server';
import type { MixLine, MixState } from './mixes/mix-form';

/** Adds (id = null) or edits a master row as the signed-in user. Row level security has the final say. */
export async function saveMaster(slug: string, id: string | null, _state: FormState, data: FormData): Promise<FormState> {
  const profile = await requireProfile();
  const def = getMaster(slug, profile.role);
  if (!def || !mayEdit(def, profile.role)) return { errors: { _form: 'not_allowed' } };

  const values = submittedValues(data);
  const parsed = parseFields(def.fields, data);
  if (!parsed.ok) return { errors: parsed.errors, values };
  const broken = slug === 'money-accounts' ? moneyAccountErrors(parsed.values) : null;
  if (broken) return { errors: broken, values };

  // A new account's opening balance is checked before the account is added, so a wrong one leaves nothing behind.
  let opening: { amountPaise: number; asOf: string } | null = null;
  if (slug === 'money-accounts' && !id) {
    const extra = parseFields(OPENING_FIELDS, data);
    if (!extra.ok) return { errors: extra.errors, values };
    const asOf = (extra.values.opening_date as string | null) ?? todayInIndia();
    if (asOf > todayInIndia()) return { errors: { opening_date: 'future_date' }, values };
    if (extra.values.opening_balance) {
      if (!parsed.values.firm_id) return { errors: { firm_id: 'account_needs_firm' }, values };
      opening = { amountPaise: extra.values.opening_balance as number, asOf };
    }
  }

  const db = await createClient();
  const { data: added, error } = id
    ? await db.from(def.table).update(parsed.values as Record<string, unknown>).eq('id', id).select('*').maybeSingle()
    : await db.from(def.table).insert(parsed.values as Record<string, unknown>).select('*').maybeSingle();
  if (error) {
    if (error.message.includes('already has its cash account')) return { errors: { kind: 'one_cash' }, values };
    const duplicate = error.code === '23505';
    return { errors: { _form: duplicate ? 'duplicate' : 'save_failed' }, detail: duplicate ? undefined : error.message, values };
  }
  if (slug === 'money-accounts' && !id && added) {
    if (opening) {
      const { error: refused } = await db.rpc('app_post_entry', { p_entry: openingMoneyBalance({ account: { id: added.id, kind: added.kind, firmId: added.firm_id }, ...opening }) });
      revalidatePath('/', 'layout');
      // The account is there; only its opening was refused (e.g. a closed month), so it is asked for again.
      if (refused) redirect(`/bankbook/${added.id}/opening?error=${encodeURIComponent(refused.message)}`);
    }
    revalidatePath('/', 'layout');
    if (added.is_active) redirect(`/bankbook/${added.id}`);
  }
  revalidatePath('/', 'layout');
  redirect(`/masters/${slug}`);
}

/**
 * The owner deletes a Setup record (a wrong or demo one): it goes to the recycle bin for 30 days, and the change log
 * names who deleted it. Records still in use (entries, reports, accounts, staff access) are refused by the database;
 * the page says what uses them. Firms are never deleted: everything hangs off them.
 */
export async function deleteMaster(slug: string, id: string, data: FormData): Promise<void> {
  const def = getMaster(slug);
  await requireProfile('owner');
  if (!def || slug === 'firms') redirect(`/masters/${slug}/${id}?error=not_allowed`);
  if (TYPE_TO_DELETE.has(slug)) {
    const { data: row } = await (await createClient()).from(def.table).select('*').eq('id', id).maybeSingle();
    if (!row || !sameName(String(data.get('confirm') ?? ''), String(row.name ?? row.ref ?? row.code))) redirect(`/masters/${slug}/${id}?error=name`);
  }
  const refused = await moveToBin(slug as BinKind, id);
  if (refused) redirect(`/masters/${slug}/${id}?${refusalQuery(refused)}`);
  revalidatePath('/', 'layout');
  redirect(`/masters/${slug}?binned=1`);
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

/** The owner deletes a combination work into the recycle bin; saved daily reports keep its name on their own lines. */
export async function deleteMix(id: string): Promise<void> {
  await requireProfile('owner');
  if (await moveToBin('mixes', id)) redirect('/masters/mixes?error=delete_failed');
  revalidatePath('/masters/mixes');
  revalidatePath('/report');
  redirect('/masters/mixes');
}
