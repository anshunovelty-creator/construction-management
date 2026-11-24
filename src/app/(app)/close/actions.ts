'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { daysInMonth } from '@/lib/wages';
import { todayInIndia } from '../entries/data';

/** Locks the books through the end of a month. Only months that are over. */
export async function lockMonth(month: string): Promise<void> {
  await requireProfile('owner');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= todayInIndia().slice(0, 7)) redirect('/close');
  const { error } = await (await createClient()).rpc('app_lock_books', { p_through: `${month}-${daysInMonth(`${month}-01`)}`, p_reason: '' });
  revalidatePath('/', 'layout');
  redirect(`/close?month=${month}${error ? `&error=${encodeURIComponent(error.message)}` : ''}`);
}

/** Moves the lock back to the end of the month before, with a reason, so a mistake can be put right. */
export async function unlockMonth(month: string, data: FormData): Promise<void> {
  await requireProfile('owner');
  const reason = String(data.get('reason') ?? '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !reason) redirect(`/close?month=${month}&error=${encodeURIComponent('Say why it is opened again.')}`);
  const before = new Date(Date.parse(`${month}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const { error } = await (await createClient()).rpc('app_lock_books', { p_through: before, p_reason: reason });
  revalidatePath('/', 'layout');
  redirect(`/close?month=${month}${error ? `&error=${encodeURIComponent(error.message)}` : ''}`);
}
