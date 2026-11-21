import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import type { BinKind } from '@/lib/bin';
import { createClient } from '@/lib/supabase/server';
import { clearDemo } from '../actions';
import { kindLabel } from '../labels';
import { DemoClear } from './demo-clear';
import { Icon } from '@/components/icons';

/** A word "test" or "demo" anywhere in the name: "TEST Brick", "Test Raju", "Demo site 2". Not "Testing" or "Contest". */
const DEMO = /\b(test|demo)\b/i;

/**
 * Clear demo data, before handing the app over: every record named test or demo, picked in one list and sent to the
 * recycle bin together. Firms are never in it. Ledger entries are never deleted, so a demo account with entries stays.
 */
export default async function DemoDataPage() {
  await requireProfile('owner');
  const [t, db] = await Promise.all([getTranslations(), createClient()]);
  const named = (table: string, extra = '') => db.from(table).select(`id, name${extra}`).or('name.ilike.%test%,name.ilike.%demo%');
  const results = await Promise.all([
    named('sites'), named('parties', ', kind'), named('money_accounts'), named('materials'), named('units'),
    named('labour_workers'), named('machines'), named('mixes'),
  ]);
  const kinds: (BinKind | 'parties-table')[] = ['sites', 'parties-table', 'money-accounts', 'materials', 'units', 'labour-workers', 'machines', 'mixes'];
  const found = results.flatMap(({ data }, i) => ((data ?? []) as unknown as { id: string; name: string; kind?: string }[])
    .filter((r) => DEMO.test(r.name))
    .map((r) => {
      const kind: BinKind = kinds[i] === 'parties-table' ? (r.kind === 'worker' || r.kind === 'staff' ? 'workers' : 'parties') : kinds[i] as BinKind;
      return { kind, id: r.id, name: r.name, from: kindLabel(t, kind) };
    }));

  return (
    <>
      <Link href="/bin" className="back"><Icon name="chevronLeft" size={16} /> {t('bin.title')}</Link>
      <h1>{t('bin.demo.title')}</h1>
      <p className="lede">{t('bin.demo.lede')}</p>
      <DemoClear items={found} action={clearDemo} />
    </>
  );
}
