'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { LabourLine, OtherLine, LineState } from '@/components/labour-form';
import type { MaterialLine, MaterialState } from '@/components/material-use-form';
import type { WorkActivity, WorkState } from '@/components/work-done-form';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { quantityToMilli } from '@/lib/ledger/bill-items';
import { siteCashExpense } from '@/lib/ledger/posting/cash';
import { COST_HEADS, type CostHead, type EntryDraft } from '@/lib/ledger/types';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';
import { payAccount } from '../pay/data';
import { dayAmount, dayPay, otCenti } from '@/lib/wages';
import { amountPaise, measurementText, quantityMilli, type Measure } from '@/lib/work';

const TABLES = ['material_use', 'work_done', 'labour_day', 'other_cost'] as const;
type Table = (typeof TABLES)[number];

/** The lines the form sent, or null when they are not a list. */
function parseLines<T>(data: FormData): T[] | null {
  try {
    const lines = JSON.parse(String(data.get('lines') ?? '[]')) as T[];
    return Array.isArray(lines) ? lines : null;
  } catch {
    return null;
  }
}

/** A rate typed in rupees, in paise; zero is allowed. Null when it is not a number. */
function ratePaise(text: string | undefined): number | null {
  try {
    const paise = rupeesToPaise((text ?? '').trim() || '0');
    return paise >= 0 ? paise : null;
  } catch {
    return null;
  }
}

async function insertLines(table: Table, rows: object[]): Promise<LineState> {
  if (rows.length === 0) return { error: 'nothing' };
  const { error } = await (await createClient()).from(table).insert(rows);
  if (error) return { error: error.code === '23505' ? 'already_marked' : 'save_failed', detail: error.code === '23505' ? undefined : error.message };
  revalidatePath('/report');
  revalidatePath('/salary', 'layout');
  return { saved: Date.now() };
}

/**
 * Who came to a site on a day: P, H (half day, workers only) or A for each worker and staff member, with OT hours for those present. The pay is
 * worked out here from the rate in Setup (see src/lib/wages.ts), never from the screen. People left unmarked are not saved.
 */
export async function addLabour(siteId: string, date: string, _state: LineState, data: FormData): Promise<LineState> {
  await requireProfile('owner', 'office', 'supervisor');
  const lines = parseLines<LabourLine>(data);
  if (!lines) return { error: 'nothing' };
  const db = await createClient();
  // Staff come without their salary, which a supervisor does not see: the database works out what their day comes to.
  const [{ data: workers }, { data: staff }] = await Promise.all([
    db.from('parties').select('id, rate_paise').eq('kind', 'worker').in('id', lines.map((l) => l.partyId)),
    db.rpc('app_site_staff'),
  ]);
  const person = new Map<string, { id: string; kind: 'worker' | 'staff'; rate: number | null }>([
    ...(workers ?? []).map((p) => [p.id as string, { id: p.id as string, kind: 'worker' as const, rate: p.rate_paise === null ? null : Number(p.rate_paise) }] as const),
    ...((staff ?? []) as { id: string; has_rate: boolean }[]).map((p) => [p.id, { id: p.id, kind: 'staff' as const, rate: p.has_rate ? 0 : null }] as const),
  ]);
  const rows = [];
  for (const [i, line] of lines.entries()) {
    if (line.mark !== 'P' && line.mark !== 'H' && line.mark !== 'A') continue;
    const p = person.get(line.partyId);
    if (!p) return { error: 'save_failed', line: i };
    const present = line.mark !== 'A';
    const half = line.mark === 'H';
    let ot: number;
    try {
      ot = otCenti(line.ot ?? '');
    } catch {
      return { error: 'bad_ot', line: i };
    }
    if (!present && ot > 0) return { error: 'ot_absent', line: i };
    if (p.kind === 'staff' && ot > 0) return { error: 'staff_no_ot', line: i };
    if (p.kind === 'staff' && half) return { error: 'staff_no_half', line: i };
    if (present && p.rate === null) return { error: 'no_rate', line: i };
    const pay = dayPay(p.kind, p.rate ?? 0, date);
    rows.push({
      site_id: siteId, work_date: date, party_id: p.id, present, half_day: half, ot_hours: ot / 100, day_pay_paise: pay, amount_paise: dayAmount(present, ot, pay, half),
    });
  }
  return insertLines('labour_day', rows);
}

/**
 * Anything else the site cost that day, like the tractor or the labour colony: what, what for, how many × rate. One paid
 * already comes out of the account it names, as an entry of its own; the rest wait for their bill. All or none are saved.
 */
export async function addOtherCost(siteId: string, date: string, _state: LineState, data: FormData): Promise<LineState> {
  await requireProfile('owner', 'office', 'supervisor');
  const lines = parseLines<OtherLine>(data);
  if (!lines) return { error: 'nothing' };
  const db = await createClient();
  const batches: { entry: EntryDraft | null; lines: object[] }[] = [];
  const unpaid: object[] = [];
  for (const [i, line] of lines.entries()) {
    const description = (line.description ?? '').trim();
    if (!description && !line.quantity?.trim() && !line.rate?.trim()) continue;
    if (!description) return { error: 'need_description', line: i };
    if (!(COST_HEADS as readonly string[]).includes(line.costHead) || line.costHead === 'material') return { error: 'pick_head', line: i };
    let milli: number;
    try {
      milli = quantityToMilli((line.quantity ?? '').trim() || '1');
    } catch {
      return { error: 'bad_quantity', line: i };
    }
    const rate = ratePaise(line.rate);
    if (rate === null) return { error: 'bad_rate', line: i };
    const amount = amountPaise(milli, rate);
    const row = { source: 'other_cost', siteId, date, description, costHead: line.costHead, quantity: milli / 1000, ratePaise: rate, amountPaise: amount };
    if (!line.paidFrom) {
      unpaid.push(row);
      continue;
    }
    if (amount <= 0) return { error: 'bad_rate', line: i };
    if (date > todayInIndia()) return { error: 'future_paid', line: i };
    const from = await payAccount(db, line.paidFrom);
    if (!from) return { error: 'bad_account', line: i };
    batches.push({ entry: siteCashExpense({ from, siteId, costHead: line.costHead as CostHead, amountPaise: amount, expenseDate: date, narration: description }), lines: [row] });
  }
  if (unpaid.length > 0) batches.push({ entry: null, lines: unpaid });
  if (batches.length === 0) return { error: 'nothing' };
  const { error } = await db.rpc('app_pay', { p_batches: batches });
  if (error) return { error: 'save_failed', detail: error.message };
  revalidatePath('/', 'layout');
  return { saved: Date.now() };
}

/** A cost typed as not paid yet, now paid from the working firm's bank or cash. */
export async function payCost(id: string, entryId: string, siteId: string, date: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  // Paid from the report, or from the list of costs not paid yet.
  const listed = data.get('back') === 'unpaid';
  const fail = (error: string): never => redirect(listed ? `/bankbook/unpaid?error=${encodeURIComponent(error)}` : `/report?site=${siteId}&date=${date}&error=${encodeURIComponent(error)}`);
  const db = await createClient();
  const paidOn = String(data.get('date') ?? '');
  const [{ data: cost }, from, working] = await Promise.all([
    db.from('other_cost').select('description, cost_head, amount_paise').eq('id', id).maybeSingle(),
    payAccount(db, String(data.get('account') ?? '')), getWorkingFirm(),
  ]);
  if (!cost) return fail('This cost is already paid or removed.');
  if (!from || from.firmId !== working?.firm.id) return fail('Choose one of this firm’s accounts.');
  if (paidOn > todayInIndia()) return fail('This date is in the future.');
  let entry;
  try {
    entry = siteCashExpense({ id: entryId, from, siteId, costHead: cost.cost_head as CostHead, amountPaise: Number(cost.amount_paise), expenseDate: paidOn, narration: cost.description as string });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { error } = await db.rpc('app_pay_cost', { p_cost: id, p_entry: entry });
  if (error) return fail(error.message);
  revalidatePath('/', 'layout');
  redirect(listed ? '/bankbook/unpaid' : `/report?site=${siteId}&date=${date}#other-title`);
}

/**
 * The material used on a site's day: a material, a quantity, a rate (optional) and a remark per line. All lines are saved or none;
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
    // An empty rate is valued at the site's average when shown.
    const rate = (line.rate ?? '').trim() ? ratePaise(line.rate) : null;
    if ((line.rate ?? '').trim() && rate === null) return { error: 'bad_rate', line: i };
    rows.push({ site_id: siteId, use_date: date, material_id: line.materialId, quantity: milli / 1000, rate_paise: rate,
      remark: (line.remark ?? '').trim(), mix_name: (line.mix ?? '').trim() });
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
    const location = (activity.location ?? '').trim() || null;
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
        site_id: siteId, work_date: date, activity: description, location, measurement: measurementText(measure, line),
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
  if (!TABLES.includes(table)) back('not_removed');
  const { data, error } = await (await createClient()).from(table).delete().eq('id', id).select('id');
  if (error || !data?.length) back(error?.message ?? 'not_removed');
  revalidatePath('/report');
  revalidatePath('/stock');
  revalidatePath('/salary', 'layout');
  back();
}

/**
 * The day's note for a site: what work was done, any extra work. One per site and day, written over when saved again;
 * saved empty, it is taken off. The change log keeps who wrote each version.
 */
export async function saveReportNote(siteId: string, date: string, _state: LineState, data: FormData): Promise<LineState> {
  await requireProfile('owner', 'office', 'supervisor');
  const note = String(data.get('note') ?? '').trim();
  if (note.length > 4000) return { error: 'note_long' };
  const db = await createClient();
  const { error } = note
    ? await db.from('report_note').upsert({ site_id: siteId, work_date: date, note }, { onConflict: 'site_id,work_date' })
    : await db.from('report_note').delete().eq('site_id', siteId).eq('work_date', date);
  if (error) return { error: 'save_failed', detail: error.message };
  revalidatePath('/report');
  return { saved: Date.now() };
}
