import type { Choices } from '@/components/form';
import type { Field, RefSource } from '@/lib/masters/registry';
import { showPaise } from '@/lib/money';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;
type Choice = { value: string; label: string };

async function load(db: Db, source: RefSource): Promise<Choice[]> {
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
    case 'moneyAccounts': {
      const { data } = await db.from('money_accounts').select('id, name').eq('is_active', true).order('name');
      return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
    }
    case 'workOrders': {
      const { data } = await db
        .from('work_orders')
        .select('id, ref, client:parties!client_id(name), site:sites(name)')
        .eq('is_active', true)
        .order('ref')
        .returns<{ id: string; ref: string; client: { name: string } | null; site: { name: string } | null }[]>();
      return (data ?? []).map((r) => ({ value: r.id, label: `${r.ref} · ${r.client?.name} · ${r.site?.name}` }));
    }
  }
}

/** Choices for every reference field in `fields`, as the signed-in user may see them. */
export async function loadChoices(db: Db, fields: Field[]): Promise<Choices> {
  const sources = [...new Set(fields.flatMap((f) => (f.kind === 'ref' || f.kind === 'multi' ? [f.ref] : [])))];
  const loaded = await Promise.all(sources.map((source) => load(db, source)));
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
    default:
      return String(value);
  }
}
