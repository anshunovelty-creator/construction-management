'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { rupeesToPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { daysInMonth, otCenti } from '@/lib/wages';
import { todayInIndia } from '../entries/data';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

function rupees(value: string): number | null {
  try {
    return rupeesToPaise(value);
  } catch {
    return null;
  }
}

/** "0.75" as 75 basis points; null unless it is a percentage with two decimals at most. */
function percentToBp(value: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const bp = Math.round(Number(value) * 100);
  return bp <= 10_000 ? bp : null;
}

/** Adds a person, or changes one. A changed rate counts from the month chosen, so earlier months stay as they were. */
export async function saveWorker(id: string | null, data: FormData): Promise<void> {
  await requireProfile('owner', 'office', 'labour');
  const form = id ? `/labour/${id}/edit` : '/labour/new';
  const fail = (error: string): never => redirect(`${form}?error=${error}`);
  const [name, kind, joined, left, rateText, oldRate] = ['name', 'kind', 'joined_on', 'left_on', 'rate', 'old_rate'].map((n) => text(data, n)) as [string, string, string, string, string, string];
  if (!name) fail('name');
  if (!id && kind !== 'worker' && kind !== 'staff') fail('kind');
  if (!DATE.test(joined)) fail('joined');
  if (left && (!DATE.test(left) || left < joined)) fail('left');
  const rate = rupees(rateText);
  if (rate === null || rate <= 0) fail('rate');
  const fromMonth = id ? text(data, 'rate_from') : joined.slice(0, 7);
  if (!MONTH.test(fromMonth)) fail('rate_from');

  const details = {
    name, joined_on: joined, left_on: left || null, phone: text(data, 'phone'), skill: text(data, 'skill'),
    uan: text(data, 'uan'), esic_number: text(data, 'esic_number'),
    pf_on: data.get('pf_on') === 'on', esic_on: data.get('esic_on') === 'on',
    is_active: id ? data.get('is_active') === 'on' : true,
  };
  const db = await createClient();
  let workerId = id;
  if (id) {
    const { error } = await db.from('labour_workers').update(details).eq('id', id);
    if (error) fail('not_saved');
  } else {
    const { data: row, error } = await db.from('labour_workers').insert({ ...details, kind }).select('id').single();
    if (error || !row) fail('not_saved');
    workerId = row!.id as string;
  }
  if (!id || String(rate) !== oldRate) {
    const { error } = await db.from('labour_rates')
      .upsert({ worker_id: workerId, from_month: `${fromMonth}-01`, rate_paise: rate }, { onConflict: 'worker_id,from_month' });
    if (error) fail('not_saved');
  }
  revalidatePath('/labour', 'layout');
  redirect(`/labour/${workerId}`);
}

/** An advance, a payment, or another cut from the salary with its reason. */
export async function addMoney(workerId: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office', 'labour');
  const page = `/labour/${workerId}`;
  const fail = (error: string): never => redirect(`${page}?error=${error}`);
  const kind = text(data, 'kind');
  const method = text(data, 'method');
  const date = text(data, 'money_date');
  const note = text(data, 'note');
  if (!['advance', 'payment', 'deduction'].includes(kind)) fail('kind');
  if (!DATE.test(date)) fail('date');
  const amount = rupees(text(data, 'amount'));
  if (amount === null || amount <= 0) fail('amount');
  const cut = kind === 'deduction';
  if (cut && !note) fail('reason');
  if (!cut && method !== 'cash' && method !== 'bank') fail('method');
  const { error } = await (await createClient()).from('labour_money').insert({
    worker_id: workerId, kind, money_date: date, amount_paise: amount, method: cut ? null : method,
    reference: cut ? '' : text(data, 'reference'), note,
  });
  if (error) fail('not_saved');
  revalidatePath('/labour', 'layout');
  redirect(page);
}

/** Takes a wrong line off: owner or office any time, the one who typed it on that day (the database checks). */
export async function removeMoney(workerId: string, id: string): Promise<void> {
  await requireProfile('owner', 'office', 'labour');
  const { data, error } = await (await createClient()).from('labour_money').delete().eq('id', id).select('id');
  if (error || !data?.length) redirect(`/labour/${workerId}?error=not_removed`);
  revalidatePath('/labour', 'layout');
  redirect(`/labour/${workerId}`);
}

/** Saves a month's card as typed, writing only the days that changed so the change log stays readable. */
export async function saveAttendance(workerId: string, month: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office', 'labour');
  const page = `/labour/attendance?worker=${workerId}&month=${month}`;
  const fail = (error: string): never => redirect(`${page}&error=${error}`);
  if (!MONTH.test(month)) fail('date');
  const db = await createClient();
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth(first)).padStart(2, '0')}`;
  const [{ data: worker }, { data: saved, error: readError }] = await Promise.all([
    db.from('labour_workers').select('kind').eq('id', workerId).maybeSingle(),
    db.from('labour_attendance').select('id, work_date, present, ot_hours').eq('worker_id', workerId).gte('work_date', first).lte('work_date', last),
  ]);
  if (!worker || readError) fail('not_saved');
  const before = new Map((saved ?? []).map((r) => [r.work_date as string, r]));
  const today = todayInIndia();
  const changed: { worker_id: string; work_date: string; present: boolean; ot_hours: number }[] = [];
  const blanked: string[] = [];
  for (let n = 1; n <= daysInMonth(first); n++) {
    const date = `${month}-${String(n).padStart(2, '0')}`;
    if (date > today) break;
    const mark = text(data, `d${n}`);
    const old = before.get(date);
    if (mark !== 'P' && mark !== 'A') {
      if (old) blanked.push(old.id as string);
      continue;
    }
    let ot = 0;
    try {
      ot = mark === 'P' && worker!.kind === 'worker' ? otCenti(text(data, `ot${n}`)) / 100 : 0;
    } catch {
      fail('ot');
    }
    if (!old || old.present !== (mark === 'P') || Number(old.ot_hours) !== ot) {
      changed.push({ worker_id: workerId, work_date: date, present: mark === 'P', ot_hours: ot });
    }
  }
  if (changed.length > 0) {
    const { error } = await db.from('labour_attendance').upsert(changed, { onConflict: 'worker_id,work_date' });
    if (error) fail('not_saved');
  }
  if (blanked.length > 0) {
    const { error } = await db.from('labour_attendance').delete().in('id', blanked);
    if (error) fail('not_saved');
  }
  revalidatePath('/labour', 'layout');
  const next = text(data, 'next');
  redirect(next ? `/labour/attendance?worker=${next}&month=${month}&saved=1` : `${page}&saved=1`);
}

/** New deduction rates from a month on. Saving the same month again replaces that month's rates. */
export async function saveSettings(data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const fail = (error: string): never => redirect(`/labour/settings?error=${error}`);
  const month = text(data, 'from_month');
  if (!MONTH.test(month)) fail('rate_from');
  const pf = percentToBp(text(data, 'pf'));
  const esic = percentToBp(text(data, 'esic'));
  if (pf === null || esic === null) fail('percent');
  const ceiling = rupees(text(data, 'pf_ceiling'));
  const limit = rupees(text(data, 'esic_limit'));
  if (ceiling === null || limit === null) fail('amount');
  const ot = text(data, 'ot_percent');
  if (!/^\d{1,3}$/.test(ot) || Number(ot) > 500) fail('ot_percent');
  const { error } = await (await createClient()).from('labour_settings').upsert({
    from_month: `${month}-01`, pf_bp: pf, pf_ceiling_paise: ceiling, esic_bp: esic, esic_limit_paise: limit, ot_percent: Number(ot),
  }, { onConflict: 'from_month' });
  if (error) fail('not_saved');
  revalidatePath('/labour', 'layout');
  redirect('/labour/settings?saved=1');
}
