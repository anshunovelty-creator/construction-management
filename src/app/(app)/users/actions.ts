'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { parseFields, submittedValues } from '@/lib/masters/parse';
import { EDIT_USER_FIELDS, NEW_USER_FIELDS } from '@/lib/masters/registry';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;

interface UserValues {
  email: string;
  password?: string;
  full_name: string;
  role: string;
  language: string;
  is_active?: boolean;
  firms: string[];
  sites: string[];
}

/**
 * Makes a user's assigned firms or sites exactly `wanted`. Runs as the owner (not the secret key)
 * so the change history records who did it. Returns an error message, or null.
 */
async function syncAssignments(
  db: Db,
  table: 'user_firms' | 'user_sites',
  column: 'firm_id' | 'site_id',
  userId: string,
  wanted: string[],
): Promise<string | null> {
  const { data, error } = await db.from(table).select(column).eq('user_id', userId);
  if (error) return error.message;
  const current = (data as Record<string, string>[]).map((row) => row[column]!);
  const removed = current.filter((v) => !wanted.includes(v));
  const added = wanted.filter((v) => !current.includes(v));
  if (removed.length > 0) {
    const { error: e } = await db.from(table).delete().eq('user_id', userId).in(column, removed);
    if (e) return e.message;
  }
  if (added.length > 0) {
    const { error: e } = await db.from(table).insert(added.map((v) => ({ user_id: userId, [column]: v })));
    if (e) return e.message;
  }
  return null;
}

/** The owner creates every login (no self sign-up): email + password, then the profile and assignments. */
export async function createUser(_state: FormState, data: FormData): Promise<FormState> {
  await requireProfile('owner');
  const values = submittedValues(data);
  const parsed = parseFields(NEW_USER_FIELDS, data);
  if (!parsed.ok) return { errors: parsed.errors, values };
  const user = parsed.values as unknown as UserValues;

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (error || !created.user) {
    const duplicate = error?.code === 'email_exists';
    return { errors: { _form: duplicate ? 'duplicate' : 'save_failed' }, detail: duplicate ? undefined : error?.message, values };
  }

  const db = await createClient();
  const userId = created.user.id;
  const { error: profileError } = await db
    .from('profiles')
    .insert({ user_id: userId, email: user.email, full_name: user.full_name, role: user.role, language: user.language });
  if (profileError) {
    await admin.auth.admin.deleteUser(userId); // no profile yet, so nothing else points at this login
    return { errors: { _form: 'save_failed' }, detail: profileError.message, values };
  }
  const failure =
    (await syncAssignments(db, 'user_firms', 'firm_id', userId, user.firms)) ??
    (await syncAssignments(db, 'user_sites', 'site_id', userId, user.sites));
  if (failure) return { errors: { _form: 'save_failed' }, detail: failure, values };

  revalidatePath('/users');
  redirect('/users');
}

export async function updateUser(userId: string, _state: FormState, data: FormData): Promise<FormState> {
  const owner = await requireProfile('owner');
  const values = submittedValues(data);
  const parsed = parseFields(EDIT_USER_FIELDS, data);
  if (!parsed.ok) return { errors: parsed.errors, values };
  const user = parsed.values as unknown as UserValues;
  // Never let the owner lock themselves out.
  if (userId === owner.user_id && (user.role !== 'owner' || !user.is_active)) {
    return { errors: { _form: 'not_allowed' }, values };
  }

  const db = await createClient();
  const { error } = await db
    .from('profiles')
    .update({ full_name: user.full_name, role: user.role, language: user.language, is_active: user.is_active })
    .eq('user_id', userId);
  const failure =
    error?.message ??
    (await syncAssignments(db, 'user_firms', 'firm_id', userId, user.firms)) ??
    (await syncAssignments(db, 'user_sites', 'site_id', userId, user.sites));
  if (failure) return { errors: { _form: 'save_failed' }, detail: failure, values };

  if (user.password) {
    const { error: e } = await createAdminClient().auth.admin.updateUserById(userId, { password: user.password });
    if (e) return { errors: { _form: 'save_failed' }, detail: e.message, values };
  }
  revalidatePath('/users');
  redirect('/users');
}
