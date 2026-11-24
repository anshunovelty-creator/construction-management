import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { RowFilter } from '@/components/row-filter';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../entries/data';
import { Stat } from '../../party/shared';
import { saveMonth } from '../actions';
import { familyGrid, loadFamilies, pickMonth, showMonth } from '../data';
import { MonthGrid } from './month-grid';

/**
 * The month for every worker on one sheet, a family to a group: each member's days and OT under the head, and the
 * family's advance with its reason, and what was paid, on the head's row.
 */
export default async function LabourMonthPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const thisMonth = todayInIndia().slice(0, 7);
  const month = pickMonth((await searchParams).month, thisMonth);
  const lines = (await loadFamilies(await createClient())).map((f) => ({ f, ...familyGrid(f, month) }))
    .filter(({ f, month: m, left }) => f.head.is_active || m || left !== 0);
  const sum = (pick: (l: (typeof lines)[number]) => number) => lines.reduce((s, l) => s + pick(l), 0);
  const typedIn = lines.flatMap((l) => l.f.members).filter((p) => p.ledger.some((m) => m.month === month)).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('labour.monthTitle')}</h1>
          <p className="lede">{t('labour.monthLede')}</p>
        </div>
      </div>

      <div className="stats">
        <Stat label={t('labour.salaryIn', { month: showMonth(month) })} value={showPaise(sum((l) => l.month?.salary ?? 0))} note={t('labour.people', { count: typedIn })} />
        <Stat label={t('labour.paidIn', { month: showMonth(month) })} value={showPaise(sum((l) => l.month?.paid ?? 0))} />
        <Stat label={t('party.balance')} value={showPaise(sum((l) => Math.max(l.left, 0)))} tone="owe" />
        <Stat label={t('party.statuses.extra')} value={showPaise(-sum((l) => Math.max(-l.left, 0)))} note={t('labour.extraNote')} tone="done" />
      </div>

      <div className="toolbar">
        {lines.length > 0 && <RowFilter table="labour-month" label={t('labour.search')} placeholder={t('labour.searchHint')} none={t('labour.searchNone')} />}
        <AutoForm action="/labour/month" className="date-filter">
          <label className="muted" htmlFor="labour-month-pick">{t('labour.month')}</label>
          <input key={month} id="labour-month-pick" type="month" name="month" defaultValue={month} max={thisMonth} required />
        </AutoForm>
      </div>

      {lines.length === 0
        ? <p className="card empty-state">{t('labour.none')}</p>
        : <MonthGrid key={month} families={lines.map((l) => l.grid)} action={saveMonth.bind(null, month)} />}
    </>
  );
}
