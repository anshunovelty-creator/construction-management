'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { rupeesToPaise } from '@/lib/money';
import { sameName } from '@/lib/delete';
import { moveToBin } from '@/lib/bin';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';

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
  const { error } = await (await createClient()).from('machine_services').insert({
    machine_id: machineId, service_date: date, running_hours: Number(hours), cost_paise: cost, note: text(data, 'note'),
  });
  if (error) fail('not_saved');
  revalidatePath('/machines', 'layout');
  redirect(page);
}

/** The owner deletes a machine, with its service record, into the recycle bin. The name must be typed first. */
export async function deleteMachine(id: string, data: FormData): Promise<void> {
  await requireProfile('owner');
  const fail = (error: string): never => redirect(`/machines/${id}/edit?error=${error}`);
  const { data: machine } = await (await createClient()).from('machines').select('name').eq('id', id).maybeSingle();
  if (!machine || !sameName(String(data.get('confirm') ?? ''), machine.name as string)) fail('delete_name');
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
