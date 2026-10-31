import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { salaryPeriod, salaryTotals, type AttendanceDay, type PersonKind } from '@/lib/wages';
import { showDate, todayInIndia } from '../entries/data';
import { PeriodBar, periodQuery } from './period';

interface DayRow extends AttendanceDay {
  party_id: string;
}

/**
 * Salary for a period, from the attendance marked on the daily reports at every site: for each worker and staff
 * member, days present and absent, OT hours, and what that comes to. Each name opens their salary slip.
 */
export default async function SalaryPage({ searchParams }: { searchParams: Promise<{ month?: string; from?: string; to?: string }> }) {
  await requireProfile('owner', 'office');
  const t = await getTranslations();
  const today = todayInIndia();
  const period = salaryPeriod(await searchParams, today);
  const db = await createClient();
  const [{ data: days }, { data: people }] = await Promise.all([
    db.from('labour_day').select('party_id, present, ot_hours, day_pay_paise, amount_paise')
      .gte('work_date', period.from).lte('work_date', period.to).returns<DayRow[]>(),
    db.from('parties').select('id, name, kind').in('kind', ['staff', 'worker'])
      .order('kind', { ascending: false }).order('name').returns<{ id: string; name: string; kind: PersonKind }[]>(),
  ]);
  const byPerson = new Map<string, DayRow[]>();
  for (const d of days ?? []) byPerson.set(d.party_id, [...(byPerson.get(d.party_id) ?? []), d]);
  const rows = (people ?? []).filter((p) => byPerson.has(p.id)).map((p) => ({ ...p, ...salaryTotals(byPerson.get(p.id)!) }));
  const sum = (kind?: PersonKind) => rows.filter((r) => !kind || r.kind === kind).reduce((total, r) => total + r.totalPaise, 0);
  const query = periodQuery(period);

  return (
    <>
      <h1>{t('salary.title')}</h1>
      <p className="lede">{t('salary.lede')}</p>
      <PeriodBar path="/salary" period={period} today={today} t={t} />
      <p className="muted">{t('salary.showing', { from: showDate(period.from), to: showDate(period.to) })}</p>
      <dl className="bill-totals">
        <div><dt>{t('salary.labour')}</dt><dd>{showPaise(sum('worker'))}</dd></div>
        <div><dt>{t('salary.staff')}</dt><dd>{showPaise(sum('staff'))}</dd></div>
        <div><dt>{t('salary.total')}</dt><dd>{showPaise(sum())}</dd></div>
      </dl>
      {rows.length === 0 ? (
        <p className="card empty-state">{t('salary.none')}</p>
      ) : (
        <div className="card table-wrap flush">
          <table className="ledger">
            <thead>
              <tr>
                <th>{t('salary.name')}</th>
                <th className="num">{t('salary.present')}</th>
                <th className="num">{t('salary.absent')}</th>
                <th className="num">{t('salary.otHours')}</th>
                <th className="num">{t('salary.dayPay')}</th>
                <th className="num">{t('salary.otPay')}</th>
                <th className="num">{t('salary.salary')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/salary/${r.id}?${query}`} className="underline"><strong>{r.name}</strong></Link>
                    {r.kind === 'staff' && <span className="pill common small-pill">{t('report.labour.staff')}</span>}
                  </td>
                  <td className="num">{r.present}</td>
                  <td className={r.absent ? 'num minus' : 'num muted'}>{r.absent}</td>
                  <td className="num">{r.otHours || '–'}</td>
                  <td className="num">{showPaise(r.dayPaise)}</td>
                  <td className="num">{r.otPaise ? showPaise(r.otPaise) : '–'}</td>
                  <td className="num"><strong>{showPaise(r.totalPaise)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>{t('salary.total')}</td>
                <td className="num"><strong>{showPaise(sum())}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
