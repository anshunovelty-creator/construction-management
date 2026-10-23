'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import type { FormState } from '@/components/form';
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from '@/i18n/locale';
import { requireProfile } from '@/lib/auth';
import { parseFields } from '@/lib/masters/parse';
import { LANGUAGE_FIELDS } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';

export async function setLanguage(_state: FormState, data: FormData): Promise<FormState> {
  await requireProfile();
  const parsed = parseFields(LANGUAGE_FIELDS, data);
  if (!parsed.ok) return { errors: parsed.errors };
  const supabase = await createClient();
  const { error } = await supabase.rpc('app_set_my_language', { p_language: parsed.values.language });
  if (error) return { errors: { _form: 'save_failed' }, detail: error.message };
  (await cookies()).set(LOCALE_COOKIE, String(parsed.values.language), LOCALE_COOKIE_OPTIONS);
  revalidatePath('/', 'layout');
  return {};
}
