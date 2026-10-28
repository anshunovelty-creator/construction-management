'use server';

import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form';
import { parseFields, submittedValues } from '@/lib/masters/parse';
import { LOGIN_FIELDS } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';

export async function signIn(_state: FormState, data: FormData): Promise<FormState> {
  const values = submittedValues(data);
  const parsed = parseFields(LOGIN_FIELDS, data);
  if (!parsed.ok) return { errors: parsed.errors, values };

  const supabase = await createClient();
  const { data: session, error } = await supabase.auth.signInWithPassword({
    email: String(parsed.values.email),
    password: String(parsed.values.password),
  });
  if (error) return { errors: { _form: 'invalid_login' }, values };

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_active')
    .eq('user_id', session.user.id)
    .maybeSingle<{ is_active: boolean }>();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { errors: { _form: 'inactive' }, values };
  }
  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
