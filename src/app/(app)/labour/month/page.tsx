import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { RowFilter } from '@/components/row-filter';
import { requireProfile } from '@/lib/auth';
import { rateFor } from '@/lib/labour';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../entries/data';
import { Stat } from '../../party/shared';
import { saveMonth } from '../actions';
import { loadLabour, pickMonth, showMonth } from '../data';
import { MonthGrid, type GridRow } from './month-grid';

const box = (value: number | undefined) => (value ? String(value) : '');
const rupeeBox = (paise: number | undefined) => (paise ? String(paise / 100) : '');

/** The month's totals for everyone on one sheet: type days, OT, advance, any deduction or addition, and what was paid. */
export default async function LabourMonthPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const thisMonth = todayInIndia().slice(0, 7);
  const month = pickMonth((await searchParams).month, thisMonth);
  const people = await loadLabour(await createClient());

  const lines = people.map((p) => {
    const m = p.ledger.find((l) => l.month === month);
    // What the months before this one left, whether or not this month is typed yet.
    const before = p.ledger.filter((l) => l.month < month).at(-1)?.balance ?? 0;
    return { p, m, before, left: m?.balance ?? before };
  }).filter(({ p, m, left }) => p.is_active || m || left !== 0);

  const rows: GridRow[] = lines.map(({ p, m, before }) => ({
    id: p.id, name: p.name, skill: p.skill, rate: rateFor(p.rates, month), before,
    days: box(m?.days), ot: box(m?.otHours), advance: rupeeBox(m?.advance), deduction: rupeeBox(m?.deduction),
    addition: rupeeBox(m?.addition), paid: rupeeBox(m?.paid), note: m?.note ?? '',
  }));
  const sum = (pick: (l: (typeof lines)[number]) => number) => lines.reduce((s, l) => s + pick(l), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('labour.monthTitle')}</h1>
          <p className="lede">{t('labour.monthLede')}</p>
        </div>
      </div>

      <div className="stats">
        <Stat label={t('labour.salaryIn', { month: showMonth(month) })} value={showPaise(sum((l) => l.m?.salary ?? 0))} note={t('labour.people', { count: lines.filter((l) => l.m).length })} />
        <Stat label={t('labour.paidIn', { month: showMonth(month) })} value={showPaise(sum((l) => l.m?.paid ?? 0))} />
        <Stat label={t('party.balance')} value={showPaise(sum((l) => Math.max(l.left, 0)))} tone="owe" />
        <Stat label={t('party.statuses.extra')} value={showPaise(-sum((l) => Math.max(-l.left, 0)))} note={t('labour.extraNote')} tone="done" />
      </div>

      <div className="toolbar">
        {rows.length > 0 && <RowFilter table="labour-month" label={t('labour.search')} placeholder={t('labour.searchHint')} none={t('labour.searchNone')} />}
        <AutoForm action="/labour/month" className="date-filter">
          <label className="muted" htmlFor="labour-month-pick">{t('labour.month')}</label>
          <input key={month} id="labour-month-pick" type="month" name="month" defaultValue={month} max={thisMonth} required />
        </AutoForm>
      </div>

      {rows.length === 0
        ? <p className="card empty-state">{t('labour.none')}</p>
        : <MonthGrid key={month} rows={rows} action={saveMonth.bind(null, month)} />}
    </>
  );
}
