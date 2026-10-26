import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { Locale } from '@/i18n/locale';
import { allowedFirms, pickWorkingFirm, type Firm } from '@/lib/firm';
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

export interface WorkingFirm {
  /** The firms this person may work in, A to Z. */
  firms: Firm[];
  /** The one they are working in now. */
  firm: Firm;
}

/**
 * The firm the signed-in user is working in (the switcher at the top right), and the firms they may switch to.
 * Null for supervisors and for office staff with no firm assigned. One lookup per request.
 */
export const getWorkingFirm = cache(async (): Promise<WorkingFirm | null> => {
  const profile = await getProfile();
  if (!profile || profile.role === 'supervisor') return null;
  const db = await createClient();
  const [{ data: firms }, { data: assigned }, { data: saved }] = await Promise.all([
    db.from('firms').select('id, name').order('name').returns<Firm[]>(),
    db.from('user_firms').select('firm_id').eq('user_id', profile.user_id),
    db.from('working_firms').select('firm_id').eq('user_id', profile.user_id).maybeSingle(),
  ]);
  const allowed = allowedFirms(profile.role, firms ?? [], (assigned ?? []).map((r) => r.firm_id as string));
  const firm = pickWorkingFirm(allowed, saved?.firm_id as string | undefined);
  return firm ? { firms: allowed, firm } : null;
});

/** Sends signed-out users to /login, and users without one of `roles` to the home page. */
export async function requireProfile(...roles: AppRole[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect('/login');
  if (roles.length > 0 && !roles.includes(profile.role)) redirect('/');
  return profile;
}
