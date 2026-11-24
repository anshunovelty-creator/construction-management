import type { AppRole } from '@/lib/auth';
import type { MoneyAccountRef } from '@/lib/ledger/types';
import type { createClient } from '@/lib/supabase/server';
import { loadAccounts, type Account } from '../bankbook/data';

type Db = Awaited<ReturnType<typeof createClient>>;

/** The banks and cash someone may pay from: the firm's own, and only for the owner and office. */
export async function payAccounts(db: Db, role: AppRole, firmId: string | null | undefined): Promise<Account[]> {
  if ((role !== 'owner' && role !== 'office') || !firmId) return [];
  return (await loadAccounts(db)).filter((a) => a.is_active && a.firm_id === firmId);
}

/** The firm that runs Labour payment, as owner and office see it. */
export async function labourFirm(db: Db): Promise<{ id: string; name: string } | null> {
  return (await db.from('firms').select('id, name').eq('runs_labour', true).maybeSingle()).data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An account chosen to pay from; null when the person may not see it or it is switched off. */
export async function payAccount(db: Db, id: string): Promise<MoneyAccountRef | null> {
  if (!UUID.test(id)) return null;
  const { data } = await db.from('money_accounts').select('id, kind, firm_id').eq('id', id).eq('is_active', true).not('firm_id', 'is', null).maybeSingle();
  return data && { id: data.id, kind: data.kind, firmId: data.firm_id };
}
