import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Supabase with the secret key: skips row level security. Only for creating logins
 * (server actions, after checking the caller is the owner) and for the import scripts.
 * Never import this from a client component.
 */
export function createAdminClient() {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
