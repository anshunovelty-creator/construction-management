'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { moveToBin, type BinKind } from '@/lib/bin';
import { sameName } from '@/lib/delete';
import { createClient } from '@/lib/supabase/server';

/** Puts a record back as it was. A same-named record added since, or a unit or site deleted since, stops it. */
export async function restoreItem(id: string, name: string): Promise<void> {
  await requireProfile('owner');
  const { error } = await (await createClient()).rpc('app_bin_restore', { p_id: id });
  if (error) redirect(`/bin?error=${error.code === '23505' ? 'duplicate' : error.code === '23503' ? 'missing_link' : 'not_restored'}`);
  revalidatePath('/', 'layout');
  redirect(`/bin?restored=${encodeURIComponent(name)}`);
}

/** Empties one item from the bin for good. */
export async function purgeItem(id: string): Promise<void> {
  await requireProfile('owner');
  const { error } = await (await createClient()).rpc('app_bin_purge', { p_id: id });
  redirect(error ? '/bin?error=not_purged' : '/bin?purged=1');
}

export interface DemoState {
  error?: 'confirm' | 'nothing';
  moved?: string[];
  kept?: { name: string; used: string }[];
}

/**
 * Before handover: sends every picked demo record to the recycle bin in one go. Works and machines go first, then
 * people and accounts, then materials, units and sites, so a record is not refused only because another demo record
 * still uses it. What real entries or reports still use stays, and is listed.
 */
const ORDER: BinKind[] = ['mixes', 'machines', 'labour-workers', 'workers', 'parties', 'money-accounts', 'materials', 'units', 'sites'];

export async function clearDemo(_state: DemoState, data: FormData): Promise<DemoState> {
  await requireProfile('owner');
  if (!sameName(String(data.get('confirm') ?? ''), 'CONFIRM')) return { error: 'confirm' };
  const picked = data.getAll('pick').map(String).map((p) => {
    const [kind, id, ...name] = p.split(':');
    return { kind: kind as BinKind, id: id!, name: name.join(':') };
  }).filter((p) => ORDER.includes(p.kind));
  if (picked.length === 0) return { error: 'nothing' };
  picked.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const moved: string[] = [];
  const kept: { name: string; used: string }[] = [];
  for (const p of picked) {
    const refused = await moveToBin(p.kind, p.id);
    if (!refused) moved.push(p.name);
    else kept.push({ name: p.name, used: refused.error === 'in_use' ? refused.used : refused.error });
  }
  revalidatePath('/', 'layout');
  return { moved, kept };
}
