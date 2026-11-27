'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { machineService } from '@/lib/ledger/posting/other';
import { PAPER_NAMES, PAPERS, type Paper } from '@/lib/machines';
import { rupeesToPaise } from '@/lib/money';
import { sameName } from '@/lib/delete';
import { moveToBin } from '@/lib/bin';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';
import { payAccount } from '../pay/data';

const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

/** Adds a machine, or changes one: its name, who has it on rent, and the hours between services. */
export async function saveMachine(id: string | null, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const fail = (error: string): never => redirect(`${id ? `/machines/${id}/edit` : '/machines/new'}?error=${error}`);
  const name = text(data, 'name');
  if (!name) fail('name');
  const every = text(data, 'service_every_hours');
  if (!/^[1-9]\d{0,5}$/.test(every)) fail('every');
  const details = { name, rented_to: text(data, 'rented_to'), service_every_hours: Number(every), is_active: id ? data.get('is_active') === 'on' : true };
  const db = await createClient();
  let machineId = id;
  if (id) {
    const { error } = await db.from('machines').update(details).eq('id', id);
    if (error) fail('not_saved');
  } else {
    const { data: row, error } = await db.from('machines').insert(details).select('id').single();
    if (error || !row) fail('not_saved');
    machineId = row!.id as string;
  }
  revalidatePath('/machines', 'layout');
  redirect(`/machines/${machineId}`);
}

/** Records a service: the date, the running hours on the meter, and what it cost. */
export async function addService(machineId: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const page = `/machines/${machineId}`;
  const fail = (error: string): never => redirect(`${page}?error=${error}`);
  const date = text(data, 'service_date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayInIndia()) fail('date');
  const hours = text(data, 'running_hours').replace(/,/g, '');
  if (!/^\d{1,8}(\.\d)?$/.test(hours)) fail('hours');
  let cost = -1;
  try {
    cost = rupeesToPaise(text(data, 'cost'));
  } catch {
    // stays below zero, refused next
  }
  if (cost < 0) fail('cost');
  const db = await createClient();
  const note = text(data, 'note');
  if (!text(data, 'account')) {
    // Not paid yet (a bill will come), or it cost nothing: a record only.
    const { error } = await db.from('machine_services').insert({ machine_id: machineId, service_date: date, running_hours: Number(hours), cost_paise: cost, note });
    if (error) fail('not_saved');
  } else {
    if (cost === 0) fail('cost');
    const [account, { data: machine }] = await Promise.all([payAccount(db, text(data, 'account')), db.from('machines').select('name').eq('id', machineId).maybeSingle()]);
    if (!account || !machine) return fail('account');
    const entry = machineService({ account, amountPaise: cost, date, narration: [machine.name, note].filter(Boolean).join(' · ') });
    const { error } = await db.rpc('app_pay', { p_batches: [{ entry, lines: [{ source: 'machine', id: machineId, hours: Number(hours), amountPaise: cost, note }] }] });
    if (error) fail(error.message.includes('not enough cash') ? 'no_cash' : 'not_saved');
    revalidatePath('/', 'layout');
  }
  revalidatePath('/machines', 'layout');
  redirect(page);
}

/**
 * Records a paper (Insurance, PUC or Fitness): its number, company, the days it is valid, and what it cost, paid from a
 * bank or cash of the firm that owns the machines, or not paid yet. The date paid is the bankbook's date.
 */
export async function addPaper(machineId: string, data: FormData): Promise<void> {
  await requireProfile('owner', 'office');
  const page = `/machines/${machineId}`;
  const fail = (error: string): never => redirect(`${page}?error=${error}#papers`);
  const paper = text(data, 'paper') as Paper;
  if (!PAPERS.includes(paper)) fail('paper');
  const [from, until, paid] = [text(data, 'valid_from'), text(data, 'valid_until'), text(data, 'paid_on')];
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from) || !day.test(until) || until < from) fail('valid');
  if (!day.test(paid) || paid > todayInIndia()) fail('date');
  let cost = -1;
  try {
    cost = rupeesToPaise(text(data, 'cost') || '0');
  } catch {
    // stays below zero, refused next
  }
  if (cost < 0) fail('cost');
  const details = { kind: paper, paper_no: text(data, 'paper_no'), company: text(data, 'company'), valid_from: from, valid_until: until };
  const note = text(data, 'note');
  const db = await createClient();
  if (!text(data, 'account')) {
    const { error } = await db.from('machine_services').insert({ machine_id: machineId, service_date: paid, running_hours: null, cost_paise: cost, note, ...details });
    if (error) fail('not_saved');
  } else {
    if (cost === 0) fail('cost');
    const [account, { data: machine }] = await Promise.all([payAccount(db, text(data, 'account')), db.from('machines').select('name').eq('id', machineId).maybeSingle()]);
    if (!account || !machine) return fail('account');
    const entry = machineService({ account, amountPaise: cost, date: paid, narration: [`${PAPER_NAMES[paper]} ${details.paper_no}`.trim(), machine.name, note].filter(Boolean).join(' · ') });
    const line = { source: 'machine', id: machineId, hours: null, amountPaise: cost, note, paper, paperNo: details.paper_no, company: details.company, validFrom: from, validUntil: until };
    const { error } = await db.rpc('app_pay', { p_batches: [{ entry, lines: [line] }] });
    if (error) fail(error.message.includes('not enough cash') ? 'no_cash' : 'not_saved');
    revalidatePath('/', 'layout');
  }
  revalidatePath('/machines', 'layout');
  redirect(`${page}#papers`);
}

/** The owner deletes a machine, with its service record, into the recycle bin. The name must be typed first. */
export async function deleteMachine(id: string, data: FormData): Promise<void> {
  await requireProfile('owner');
  const fail = (error: string): never => redirect(`/machines/${id}/edit?error=${error}`);
  const { data: machine } = await (await createClient()).from('machines').select('name').eq('id', id).maybeSingle();
  if (!machine || !sameName(String(data.get('confirm') ?? ''), machine.name as string)) fail('delete_name');
  // Deleting it would take its paid services off with it, and their money back into the account.
  const { count } = await (await createClient()).from('machine_services').select('id', { count: 'exact', head: true }).eq('machine_id', id).not('entry_id', 'is', null);
  if (count) fail('has_paid');
  if (await moveToBin('machines', id)) fail('not_deleted');
  revalidatePath('/machines', 'layout');
  redirect('/machines');
}

/** Takes a wrong service line off, so it can be typed again. The change log keeps it. */
export async function removeService(machineId: string, id: string): Promise<void> {
  await requireProfile('owner', 'office');
  const { data, error } = await (await createClient()).from('machine_services').delete().eq('id', id).select('id');
  if (error || !data?.length) redirect(`/machines/${machineId}?error=not_removed`);
  revalidatePath('/machines', 'layout');
  redirect(`/machines/${machineId}`);
}
