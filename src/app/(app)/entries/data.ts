import type { Names } from '@/lib/ledger/plain';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;

/** Names of everything an entry can mention, as the signed-in user may see them. */
export async function loadNames(db: Db): Promise<Names & { people: Map<string, string> }> {
  const [firms, parties, sites, accounts, people] = await Promise.all([
    db.from('firms').select('id, name'),
    db.from('parties').select('id, name'),
    db.from('sites').select('id, name'),
    db.from('money_accounts').select('id, name'),
    db.from('profiles').select('user_id, full_name'),
  ]);
  const map = (rows: { id: string; name: string }[] | null) => new Map((rows ?? []).map((r) => [r.id, r.name]));
  return {
    firms: map(firms.data),
    parties: map(parties.data),
    sites: map(sites.data),
    accounts: map(accounts.data),
    people: new Map((people.data ?? []).map((p) => [p.user_id as string, p.full_name as string])),
  };
}

const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2026-10-17" -> "17 Oct 2026". */
export const showDate = (ymd: string) => DAY.format(new Date(`${ymd}T00:00:00Z`));

/** Today in India, as YYYY-MM-DD. */
export const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
