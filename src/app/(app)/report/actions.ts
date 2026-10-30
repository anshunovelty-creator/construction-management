'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { MaterialLine, MaterialState } from '@/components/material-use-form';
import type { WorkActivity, WorkState } from '@/components/work-done-form';
import { requireProfile } from '@/lib/auth';
import { quantityToMilli } from '@/lib/ledger/bill-items';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { amountPaise, measurementText, quantityMilli, type Measure } from '@/lib/work';

type Table = 'material_use' | 'work_done';

/**
 * The material used on a site's day: a material, a quantity and a remark per line. All lines are saved or none;
 * on a mistake the form keeps what was typed and is told which line is wrong.
 */
export async function addMaterialUse(siteId: string, date: string, _state: MaterialState, data: FormData): Promise<MaterialState> {
  await requireProfile('owner', 'office', 'supervisor');
  let lines: MaterialLine[];
  try {
    lines = JSON.parse(String(data.get('lines') ?? '[]')) as MaterialLine[];
    if (!Array.isArray(lines)) throw new Error();
  } catch {
    return { error: 'nothing' };
  }
  const rows = [];
  for (const [i, line] of lines.entries()) {
    const quantity = (line.quantity ?? '').trim();
    if (!line.materialId && !quantity) continue;
    if (!line.materialId) return { error: 'pick_material', line: i };
    let milli: number;
    try {
      milli = quantityToMilli(quantity);
    } catch {
      return { error: 'bad_quantity', line: i };
    }
    rows.push({ site_id: siteId, use_date: date, material_id: line.materialId, quantity: milli / 1000, remark: (line.remark ?? '').trim() });
  }
  if (rows.length === 0) return { error: 'nothing' };
  const { error } = await (await createClient()).from('material_use').insert(rows);
  if (error) return { error: 'save_failed', detail: error.message };
  revalidatePath('/report');
  revalidatePath('/stock');
  return { saved: Date.now() };
}

/**
 * The work done on a site's day, typed as activities: a description, a unit, a rate, and one or more measurement
 * lines. Every quantity and amount is worked out again here from the boxes; the screen's own sums are only a preview.
 */
export async function addWorkDone(siteId: string, date: string, _state: WorkState, data: FormData): Promise<WorkState> {
  await requireProfile('owner', 'office', 'supervisor');
  let activities: WorkActivity[];
  try {
    activities = JSON.parse(String(data.get('work') ?? '[]')) as WorkActivity[];
    if (!Array.isArray(activities)) throw new Error();
  } catch {
    return { error: 'nothing' };
  }
  const db = await createClient();
  const { data: units } = await db.from('units').select('id, measure');
  const measureOf = new Map((units ?? []).map((u) => [u.id as string, u.measure as Measure]));

  const rows = [];
  for (const [a, activity] of activities.entries()) {
    const lines = activity.lines.filter((l) => Object.values(l).some((v) => (v ?? '').trim() !== ''));
    const description = (activity.description ?? '').trim();
    if (!description && lines.length === 0 && !activity.rate?.trim()) continue; // an activity left empty
    if (!description) return { error: 'need_activity', activity: a };
    const measure = measureOf.get(activity.unitId);
    if (!measure) return { error: 'pick_unit', activity: a };
    let ratePaise: number;
    try {
      ratePaise = rupeesToPaise(activity.rate?.trim() || '0');
    } catch {
      return { error: 'bad_rate', activity: a };
    }
    if (ratePaise < 0) return { error: 'bad_rate', activity: a };
    if (lines.length === 0) return { error: 'need_measurement', activity: a };
    for (const line of lines) {
      let milli: number;
      try {
        milli = quantityMilli(measure, line);
      } catch (error) {
        return { error: `bad_${(error as Error).message}`, activity: a, line: activity.lines.indexOf(line) };
      }
      rows.push({
        site_id: siteId, work_date: date, activity: description, measurement: measurementText(measure, line),
        quantity: milli / 1000, unit_id: activity.unitId, rate_paise: ratePaise, amount_paise: amountPaise(milli, ratePaise),
      });
    }
  }
  if (rows.length === 0) return { error: 'nothing' };
  const { error } = await db.from('work_done').insert(rows);
  if (error) return { error: 'save_failed', detail: error.message };
  revalidatePath('/report');
  return { saved: Date.now() };
}

/** Takes a wrong line off the report; the database allows it for the office, or its supervisor on the same day. */
export async function removeReportLine(table: Table, id: string, siteId: string, date: string): Promise<void> {
  await requireProfile('owner', 'office', 'supervisor');
  const back = (error?: string): never =>
    redirect(`/report?site=${siteId}&date=${date}${error ? `&error=${encodeURIComponent(error)}` : ''}`);
  if (table !== 'material_use' && table !== 'work_done') back('not_removed');
  const { data, error } = await (await createClient()).from(table).delete().eq('id', id).select('id');
  if (error || !data?.length) back(error?.message ?? 'not_removed');
  revalidatePath('/report');
  revalidatePath('/stock');
  back();
}
