import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { Locale } from '@/i18n/locale';
import { createClient } from '@/lib/supabase/server';

export type AppRole = 'owner' | 'office' | 'supervisor';

export interface Profile {
  user_id: string;
  email: string;
  full_name: string;
  role: AppRole;
  language: Locale;
  is_active: boolean;
}

/** The signed-in user's profile, or null when signed out or deactivated. One lookup per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return null;
  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle<Profile>();
  return profile?.is_active ? profile : null;
});

/** Sends signed-out users to /login, and users without one of `roles` to the home page. */
export async function requireProfile(...roles: AppRole[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect('/login');
  if (roles.length > 0 && !roles.includes(profile.role)) redirect('/');
  return profile;
}
