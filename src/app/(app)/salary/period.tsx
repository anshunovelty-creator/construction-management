import Link from 'next/link';
import type { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { lastMonth } from '@/lib/wages';

type T = Awaited<ReturnType<typeof getTranslations>>;

/** The query string for a period: a whole month, or from–to dates. */
export const periodQuery = (p: { from: string; to: string; month?: string }) =>
  p.month ? `month=${p.month}` : `from=${p.from}&to=${p.to}`;

/** Pick the salary period: this month, last month, any month, or any from–to dates. A pick opens straight away. */
export function PeriodBar({ path, period, today, t }: { path: string; period: { from: string; to: string; month?: string }; today: string; t: T }) {
  const thisMonth = today.slice(0, 7);
  return (
    <div className="card report-bar salary-bar no-print">
      <nav className="filters" aria-label={t('salary.period')}>
        <Link href={`${path}?month=${thisMonth}`} className={`chip${period.month === thisMonth ? ' on' : ''}`}>{t('salary.thisMonth')}</Link>
        <Link href={`${path}?month=${lastMonth(thisMonth)}`} className={`chip${period.month === lastMonth(thisMonth) ? ' on' : ''}`}>{t('salary.lastMonth')}</Link>
      </nav>
      <AutoForm action={path} className="date-filter">
        <label className="muted" htmlFor="salary-month">{t('salary.month')}</label>
        <input key={period.month} id="salary-month" type="month" name="month" defaultValue={period.month ?? ''} max={thisMonth} required />
      </AutoForm>
      <AutoForm action={path} className="date-filter">
        <label className="muted" htmlFor="salary-from">{t('salary.from')}</label>
        <input key={`f${period.from}`} id="salary-from" type="date" name="from" defaultValue={period.from} max={today} required />
        <label className="muted" htmlFor="salary-to">{t('salary.to')}</label>
        <input key={`t${period.to}`} id="salary-to" type="date" name="to" defaultValue={period.to} max={today} required />
      </AutoForm>
    </div>
  );
}
