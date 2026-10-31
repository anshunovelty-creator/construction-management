import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { PrintButton } from '@/components/print-button';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { salaryPeriod, salaryTotals, type AttendanceDay, type PersonKind } from '@/lib/wages';
import { rupeesInWords } from '@/lib/words';
import { showDate, todayInIndia } from '../../entries/data';
import { PeriodBar, periodQuery } from '../period';

interface DayRow extends AttendanceDay {
  id: string;
  work_date: string;
  site_id: string;
}

/** One person's salary slip for a period: every day marked, at any site, with OT, and the total in words. */
export default async function SalarySlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; from?: string; to?: string }>;
}) {
  await requireProfile('owner', 'office');
  const { id } = await params;
  const t = await getTranslations();
  const today = todayInIndia();
  const period = salaryPeriod(await searchParams, today);
  const db = await createClient();
  const [{ data: person }, { data: days }, { data: sites }] = await Promise.all([
    db.from('parties').select('id, name, kind, phone, rate_paise').eq('id', id).in('kind', ['staff', 'worker'])
      .maybeSingle<{ id: string; name: string; kind: PersonKind; phone: string; rate_paise: number | null }>(),
    db.from('labour_day').select('id, work_date, site_id, present, ot_hours, day_pay_paise, amount_paise')
      .eq('party_id', id).gte('work_date', period.from).lte('work_date', period.to).order('work_date').returns<DayRow[]>(),
    db.from('sites').select('id, name'),
  ]);
  if (!person) notFound();
  const siteName = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]));
  const rows = days ?? [];
  const totals = salaryTotals(rows);

  return (
    <>
      <p className="mb-2 no-print">
        <Link href={`/salary?${periodQuery(period)}`} className="back"><Icon name="chevronLeft" size={16} /> {t('salary.title')}</Link>
      </p>
      <PeriodBar path={`/salary/${id}`} period={period} today={today} t={t} />

      <article className="card slip">
        <header className="slip-head">
          <div>
            <p className="muted">{t('salary.slip')}</p>
            <h1>{person.name}</h1>
            <p className="muted">
              {t(`options.worker_kind.${person.kind}`)}
              {person.rate_paise !== null && ` · ${showPaise(Number(person.rate_paise))} ${t(`report.labour.per.${person.kind}`)}`}
              {person.phone && ` · ${person.phone}`}
            </p>
          </div>
          <div className="slip-period">
            <p className="muted">{t('salary.periodLabel')}</p>
            <p><strong>{showDate(period.from)} – {showDate(period.to)}</strong></p>
            <PrintButton label={t('salary.print')} />
          </div>
        </header>

        {rows.length === 0 ? (
          <p className="empty-state">{t('salary.noDays')}</p>
        ) : (
          <div className="table-wrap">
            <table className="ledger salary-table">
              <thead>
                <tr>
                  <th>{t('salary.date')}</th>
                  <th className="wide-only">{t('salary.site')}</th>
                  <th>{t('salary.mark')}</th>
                  <th className="num">{t('salary.otHours')}</th>
                  <th className="num wide-only">{t('salary.dayPay')}</th>
                  <th className="num wide-only">{t('salary.otPay')}</th>
                  <th className="num">{t('salary.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dayPart = r.present ? Number(r.day_pay_paise) : 0;
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{showDate(r.work_date)}</td>
                      <td className="wide-only">{siteName.get(r.site_id)}</td>
                      <td><span className={`pill ${r.present ? 'verified' : 'pending'}`} title={t(`report.labour.mark.${r.present ? 'P' : 'A'}`)}>{r.present ? 'P' : 'A'}</span></td>
                      <td className="num">{Number(r.ot_hours) || '–'}</td>
                      <td className="num wide-only">{dayPart ? showPaise(dayPart) : '–'}</td>
                      <td className="num wide-only">{Number(r.amount_paise) - dayPart ? showPaise(Number(r.amount_paise) - dayPart) : '–'}</td>
                      <td className="num">{showPaise(Number(r.amount_paise))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>{t('salary.total')}</td>
                  <td className="wide-only" />
                  <td>{t('salary.daysSummary', { p: totals.present, a: totals.absent })}</td>
                  <td className="num">{totals.otHours || '–'}</td>
                  <td className="num wide-only">{showPaise(totals.dayPaise)}</td>
                  <td className="num wide-only">{totals.otPaise ? showPaise(totals.otPaise) : '–'}</td>
                  <td className="num"><strong>{showPaise(totals.totalPaise)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <dl className="bill-totals slip-totals">
          <div><dt>{t('salary.forDays', { n: totals.present })}</dt><dd>{showPaise(totals.dayPaise)}</dd></div>
          <div><dt>{t('salary.forOt', { n: totals.otHours })}</dt><dd>{showPaise(totals.otPaise)}</dd></div>
          <div><dt>{t('salary.salary')}</dt><dd>{showPaise(totals.totalPaise)}</dd></div>
        </dl>
        <p className="slip-words"><span className="muted">{t('salary.inWords')}</span> {rupeesInWords(totals.totalPaise)}</p>
        <div className="slip-sign">
          <span>{t('salary.signWorker')}</span>
          <span>{t('salary.signOffice')}</span>
        </div>
      </article>
    </>
  );
}
