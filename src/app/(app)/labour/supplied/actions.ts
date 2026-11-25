'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { supplied } from '@/lib/labour-supply';
import { firmSupply } from '@/lib/ledger/posting/firms';
import { percentOf } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../entries/data';
import { loadFirms } from '../../between/data';
import { daysInMonth } from '@/lib/wages';
import { loadConfirmed, loadSupplied } from './data';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const NUMBER = /^\d{1,3}(\.\d{1,2})?$/;
const UUID = /^[0-9a-f-]{36}$/i;

export interface WorkerPlaces { id: string; lines: { placeId: string; days: string; ot: string }[] }
export type PlacesState = { error?: string; name?: string; saved?: number };

/**
 * Where the changed workers' days were. One place is kept as all of the month and becomes their usual place; several
 * must add up to the days and OT typed on the monthly entry.
 */
export async function savePlaces(month: string, _: PlacesState, data: FormData): Promise<PlacesState> {
  await requireProfile('owner', 'office', 'labour');
  if (!MONTH.test(month) || month > todayInIndia().slice(0, 7)) return { error: 'date' };
  let changed: WorkerPlaces[];
  try {
    changed = JSON.parse(String(data.get('rows') ?? '[]')) as WorkerPlaces[];
    if (!Array.isArray(changed)) throw new Error();
  } catch {
    return { error: 'not_saved' };
  }
  const db = await createClient();
  const { workers } = await loadSupplied(db, month);
  const known = new Map(workers.map((w) => [w.id, w]));
  for (const row of changed) {
    const worker = known.get(row.id);
    const lines = row.lines.filter((l) => l.placeId);
    const fail = (error: string) => ({ error, name: worker?.name });
    if (!worker || !lines.every((l) => UUID.test(l.placeId)) || new Set(lines.map((l) => l.placeId)).size !== lines.length) return fail('place_twice');
    if (lines.length > 1) {
      if (!lines.every((l) => NUMBER.test(l.days || '0') && NUMBER.test(l.ot || '0'))) return fail('days');
      const sum = (pick: (l: (typeof lines)[number]) => string) => Math.round(lines.reduce((s, l) => s + Number(pick(l) || 0), 0) * 100) / 100;
      if (sum((l) => l.days) !== worker.days || sum((l) => l.ot) !== worker.ot) return fail('place_sum');
    }
  }
  for (const row of changed) {
    const lines = row.lines.filter((l) => l.placeId);
    const first = `${month}-01`;
    if (lines.length > 0) {
      const { error } = await db.from('labour_month_places').upsert(
        lines.map((l) => ({ worker_id: row.id, month: first, place_id: l.placeId, days: lines.length > 1 ? Number(l.days || 0) : 0, ot_hours: lines.length > 1 ? Number(l.ot || 0) : 0 })),
        { onConflict: 'worker_id,month,place_id' },
      );
      if (error) return { error: 'not_saved' };
    }
    let gone = db.from('labour_month_places').delete().eq('worker_id', row.id).eq('month', first);
    if (lines.length > 0) gone = gone.not('place_id', 'in', `(${lines.map((l) => l.placeId).join(',')})`);
    const { error } = await gone;
    if (error) return { error: 'not_saved' };
    if (lines.length === 1) await db.from('labour_workers').update({ place_id: lines[0]!.placeId }).eq('id', row.id);
  }
  revalidatePath('/labour', 'layout');
  return { saved: changed.length };
}

/**
 * Puts a month's labour in the books of both firms: one entry per firm and site. Confirming again replaces the entries
 * whose amount, GST or TDS changed, and cancels one whose site no longer has any labour. The amounts are worked out here.
 */
export async function confirmSupplied(month: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const fail = (error: string): never => redirect(`/labour/supplied?month=${month}&error=${encodeURIComponent(error)}`);
  const today = todayInIndia();
  if (!MONTH.test(month) || month > today.slice(0, 7)) fail('date');
  const [db, words] = await Promise.all([createClient(), getTranslations()]);
  const [{ workers, places }, firms, confirmed, working] = await Promise.all([loadSupplied(db, month), loadFirms(db), loadConfirmed(db, month), getWorkingFirm()]);
  const supplier = firms.find((f) => f.runs_labour);
  if (!supplier) return fail('no_labour_firm');
  const mine = new Set(working?.firms.map((f) => f.id));
  const { places: totals, unplaced } = supplied(workers, month);
  if (unplaced.length > 0) fail('unplaced');

  // What is worked out from a worker's usual place now stays so, whatever their usual place becomes later.
  const usual = workers.filter((w) => w.said.length === 0 && w.usual).map((w) => ({ worker_id: w.id, month: `${month}-01`, place_id: w.usual! }));
  if (usual.length > 0) {
    const { error } = await db.from('labour_month_places').upsert(usual, { onConflict: 'worker_id,month,place_id' });
    if (error) fail('not_saved');
  }

  const last = `${month}-${daysInMonth(`${month}-01`)}`;
  const date = last < today ? last : today;
  // Each firm and site is an entry of its own, so one that is refused does not stop the others; the page says which and why.
  const refused: string[] = [];
  for (const place of places.filter((p) => p.firm_id && p.site_id)) {
    const charged = totals.get(place.id)?.charged ?? 0;
    const old = confirmed.get(`${place.firm_id}/${place.site_id}`);
    if (charged === 0 && !old) continue;
    if (!mine.has(supplier.id) || !mine.has(place.firm_id!)) {
      refused.push(`${place.name}: ${words('supplied.errors.need_both')}`);
      continue;
    }
    if (charged === 0) {
      const { error } = await db.rpc('app_reverse_entry', { p_entry_id: old!.entryId, p_reason: 'No labour at this site any more' });
      if (error) refused.push(`${place.name}: ${error.message}`);
      continue;
    }
    const bp = (name: string) => {
      const value = String(data.get(`${place.id}:${name}`) ?? '');
      return /^\d{1,5}$/.test(value) ? Number(value) : 0;
    };
    const [gstBp, tdsBp] = [bp('gst'), bp('tds')];
    if (old && old.base === charged && old.gst === percentOf(charged, gstBp) && old.tds === percentOf(charged, tdsBp)) continue;
    const t = totals.get(place.id)!;
    const draft = firmSupply({
      kind: 'labour_supplied', supplierId: supplier.id, takerId: place.firm_id!, siteId: place.site_id!, amountPaise: charged, gstBp, tdsBp, date,
      reference: month, narration: `${t.days} days${t.ot ? `, ${t.ot} OT hours` : ''}`,
    });
    const { error } = old
      ? await db.rpc('app_replace_entry', { p_old_id: old.entryId, p_new: draft, p_reason: 'Month confirmed again' })
      : await db.rpc('app_post_entry', { p_entry: draft });
    if (error) refused.push(`${place.name}: ${error.message}`);
  }
  revalidatePath('/', 'layout');
  if (refused.length > 0) redirect(`/labour/supplied?month=${month}&refused=${encodeURIComponent(refused.join('\n'))}`);
  redirect(`/labour/supplied?month=${month}&confirmed=1`);
}

const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

/** Adds a place: one of our firms' sites, or an outside customer. Its name is made from theirs. */
export async function addPlace(data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const fail = (error: string): never => redirect(`/labour/places?error=${error}`);
  const db = await createClient();
  const [firmId, siteId, clientId] = ['firm', 'site', 'client'].map((n) => text(data, n));
  const outside = text(data, 'kind') === 'client';
  if (outside ? !UUID.test(clientId!) : !UUID.test(firmId!) || !UUID.test(siteId!)) fail('place');
  const [firm, site, client] = await Promise.all([
    outside ? null : db.from('firms').select('name, runs_labour').eq('id', firmId!).maybeSingle(),
    outside ? null : db.from('sites').select('name').eq('id', siteId!).maybeSingle(),
    outside ? db.from('parties').select('name').eq('id', clientId!).eq('kind', 'client').maybeSingle() : null,
  ]);
  if (outside ? !client?.data : !firm?.data || !site?.data || firm.data.runs_labour) fail('place');
  const { error } = await db.from('labour_places').insert(outside
    ? { name: client!.data!.name, client_id: clientId }
    : { name: `${firm!.data!.name} · ${site!.data!.name}`, firm_id: firmId, site_id: siteId });
  if (error) fail(error.code === '23505' ? 'place_exists' : 'not_saved');
  revalidatePath('/labour', 'layout');
  redirect('/labour/places');
}

/** Switches a place on or off; one switched off is no longer offered, and months already there keep it. */
export async function switchPlace(id: string, on: boolean): Promise<void> {
  await requireProfile('owner', 'office');
  await (await createClient()).from('labour_places').update({ is_active: on }).eq('id', id);
  revalidatePath('/labour', 'layout');
  redirect('/labour/places');
}
