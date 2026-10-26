import type { getTranslations } from 'next-intl/server';
import type { Choices } from '@/components/form';
import type { WorkingFirm } from '@/lib/auth';
import { accountChoices, accountScope, type AccountRow } from '@/lib/firm';
import type { Choice, Field, RefSource } from '@/lib/masters/registry';
import { showPaise } from '@/lib/money';
import type { createClient } from '@/lib/supabase/server';
import { showDate } from '../entries/data';

type Db = Awaited<ReturnType<typeof createClient>>;
type T = Awaited<ReturnType<typeof getTranslations>>;

/** Narrows entry form lists to the working firm. Setup screens load without it and list everything. */
export interface ChoiceScope {
  working: WorkingFirm;
  t: T;
}

async function load(db: Db, source: RefSource, scope?: ChoiceScope): Promise<Choice[]> {
  switch (source) {
    case 'firms': {
      const { data } = await db.from('firms').select('id, code, name').order('code');
      return (data ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }));
    }
    case 'sites': {
      const { data } = await db.from('sites').select('id, name').order('name');
      return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
    }
    case 'clients': {
      const { data } = await db.from('parties').select('id, name').eq('kind', 'client').order('name');
      return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
    }
    case 'supervisors': {
      const { data } = await db.from('profiles').select('user_id, full_name').eq('role', 'supervisor').order('full_name');
      return (data ?? []).map((r) => ({ value: r.user_id, label: r.full_name }));
    }
    case 'vendors':
    case 'parties': {
      let query = db.from('parties').select('id, name').eq('is_active', true);
      if (source === 'vendors') query = query.eq('kind', 'vendor');
      const { data } = await query.order('name');
      return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
    }
    case 'materials': {
      const { data } = await db.from('materials').select('id, name').eq('is_active', true).order('name');
      return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
    }
    case 'moneyAccounts':
    case 'moneyAccountsWeOwe':
    case 'moneyAccountsTheyOwe': {
      const { data } = await db
        .from('money_accounts')
        .select('id, name, firm_id')
        .eq('is_active', true)
        .order('name')
        .returns<AccountRow[]>();
      if (!scope) return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
      const { firm, firms } = scope.working;
      const nameOf = (id: string) => firms.find((f) => f.id === id)?.name ?? '';
      // "Other firm: AB Infra will owe Jayraj Infra": the due that picking one of these accounts leaves behind.
      const groupOf = (other: string) =>
        scope.t(source === 'moneyAccountsWeOwe' ? 'firm.otherWeOwe' : 'firm.otherTheyOwe', { us: firm.name, them: nameOf(other) });
      return accountChoices(data ?? [], accountScope(source)!, firm.id, groupOf);
    }
    case 'workOrders': {
      let query = db
        .from('work_orders')
        .select('id, ref, client:parties!client_id(name), site:sites(name)')
        .eq('is_active', true);
      if (scope) query = query.eq('firm_id', scope.working.firm.id);
      const { data } = await query
        .order('ref')
        .returns<{ id: string; ref: string; client: { name: string } | null; site: { name: string } | null }[]>();
      return (data ?? []).map((r) => ({ value: r.id, label: `${r.ref} · ${r.client?.name} · ${r.site?.name}` }));
    }
  }
}

/** Choices for every reference field in `fields`, as the signed-in user may see them; in `scope`'s firm when given. */
export async function loadChoices(db: Db, fields: Field[], scope?: ChoiceScope): Promise<Choices> {
  const sources = [...new Set(fields.flatMap((f) => (f.kind === 'ref' || f.kind === 'multi' ? [f.ref] : [])))];
  const loaded = await Promise.all(sources.map((source) => load(db, source, scope)));
  return Object.fromEntries(sources.map((source, i) => [source, loaded[i]]));
}

/** A stored value as the list shows it. */
export function displayValue(field: Field, value: unknown, choices: Choices, t: (key: string) => string): string {
  if (field.kind === 'checkbox') return t(value ? 'common.yes' : 'common.no');
  if (value === null || value === undefined || value === '') return t('common.none');
  switch (field.kind) {
    case 'enum':
      return t(`options.${field.enum}.${String(value)}`);
    case 'ref':
      return choices[field.ref]?.find((c) => c.value === value)?.label ?? t('common.none');
    case 'rupees':
      return showPaise(Number(value));
    case 'percent':
      return `${Number(value) / 100}%`;
    case 'date':
      return showDate(String(value));
    default:
      return String(value);
  }
}
