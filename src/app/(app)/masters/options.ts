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
    case 'units': {
      const { data } = await db.from('units').select('id, name').eq('is_active', true).order('name');
      return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
    }
    case 'materials': {
      const { data } = await db.from('materials').select('id, name').eq('is_active', true).order('name');
      return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
    }
    case 'gstRates': {
      // A bill line keeps the rate itself, not the row, so the value is the rate in basis points.
      const { data } = await db.from('gst_rates').select('rate_bp').eq('is_active', true).order('rate_bp');
      return (data ?? []).map((r) => ({ value: String(r.rate_bp), label: `${r.rate_bp / 100}%` }));
    }
    case 'tdsRates': {
      // Like GST, a bill keeps the rate itself; the section says which rule the rate comes from.
      const { data } = await db.from('tds_rates').select('rate_bp, section').eq('is_active', true).order('rate_bp');
      return (data ?? []).map((r) => ({
        value: String(r.rate_bp),
        label: r.section ? `${r.rate_bp / 100}% · ${r.section}` : `${r.rate_bp / 100}%`,
      }));
    }
    case 'moneyAccounts':
    case 'firmAccounts': {
      // Payments and receipts (firmAccounts) never offer supervisor cash; only the firm's own accounts are listed.
      let query = db.from('money_accounts').select('id, name, firm_id').eq('is_active', true).order('name');
      if (source === 'firmAccounts') query = query.neq('kind', 'supervisor_cash');
      const { data } = await query.returns<AccountRow[]>();
      if (!scope) return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
      return accountChoices(data ?? [], accountScope(source)!, scope.working.firm.id);
    }
  }
}

/** Choices for every reference field in `fields`, as the signed-in user may see them; in `scope`'s firm when given. */
export async function loadChoices(db: Db, fields: Field[], scope?: ChoiceScope): Promise<Choices> {
  const sources = [...new Set(fields.flatMap((f): RefSource[] =>
    f.kind === 'ref' || f.kind === 'multi' ? [f.ref] : f.kind === 'items' ? ['materials', 'gstRates'] : []))];
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
