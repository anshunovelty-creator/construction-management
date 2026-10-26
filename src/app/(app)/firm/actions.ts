'use server';

import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export type SwitchState = { failed?: boolean };

/** Makes the chosen firm the working firm, then reloads the page the person is on. The database checks they may use it. */
export async function switchFirm(_state: SwitchState, data: FormData): Promise<SwitchState> {
  await requireProfile('owner', 'office');
  const db = await createClient();
  const { error } = await db.rpc('app_set_my_firm', { p_firm_id: String(data.get('firm') ?? '') });
  if (error) return { failed: true };
  revalidatePath('/', 'layout');
  return {};
}
