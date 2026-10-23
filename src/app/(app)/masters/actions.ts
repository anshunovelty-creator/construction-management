'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { parseFields, submittedValues } from '@/lib/masters/parse';
import { getMaster } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';

/** Adds (id = null) or edits a master row as the signed-in user. Row level security has the final say. */
export async function saveMaster(slug: string, id: string | null, _state: FormState, data: FormData): Promise<FormState> {
  const def = getMaster(slug);
  const profile = await requireProfile('owner', 'office');
  if (!def || (def.ownerOnly && profile.role !== 'owner')) return { errors: { _form: 'not_allowed' } };

  const values = submittedValues(data);
  const parsed = parseFields(def.fields, data);
  if (!parsed.ok) return { errors: parsed.errors, values };

  const db = await createClient();
  const { error } = id
    ? await db.from(def.table).update(parsed.values as Record<string, unknown>).eq('id', id)
    : await db.from(def.table).insert(parsed.values as Record<string, unknown>);
  if (error) {
    const duplicate = error.code === '23505';
    return { errors: { _form: duplicate ? 'duplicate' : 'save_failed' }, detail: duplicate ? undefined : error.message, values };
  }
  revalidatePath(`/masters/${slug}`);
  redirect(`/masters/${slug}`);
}
