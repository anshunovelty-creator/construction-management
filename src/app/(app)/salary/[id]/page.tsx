import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { RupeesInput } from '@/components/form';
import { PrintButton } from '@/components/print-button';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { pfCut, pfRate, salaryLedger, salaryPeriod, salaryRow, salaryTotals, type AttendanceDay } from '@/lib/wages';
import { rupeesInWords } from '@/lib/words';
import { showDate, todayInIndia } from '../../entries/data';
import { showMonth } from '../../labour/data';
import { BalanceCell, MoneyCell } from '../../party/shared';
import { addSalaryMoney, removeSalaryMoney } from '../actions';
import { loadSalaryPeople } from '../data';
import { PeriodBar, periodQuery } from '../period';
import { PfSwitch } from '../pf-switch';

interface DayRow extends AttendanceDay {
  id: string;
  work_date: string;
  site_id: string;
}

/**
 * One person's salary slip for a period: every day marked, at any site, with OT; PF, advances and deductions taken off;
 * what was left from before, paid and left. Below it, their money lines and their ledger month by month.
 */
export default async function SalarySlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; from?: string; to?: string; error?: string }>;
}) {
  await requireProfile('owner', 'office');
  const { id } = await params;
  const t = await getTranslations();
  const today = todayInIndia();
  const asked = await searchParams;
  const period = salaryPeriod(asked, today);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await createClient();
  const [[person], { data: sites }] = await Promise.all([loadSalaryPeople(db, today, id), db.from('sites').select('id, name')]);
  if (!person) notFound();
  const siteName = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]));
  const rows = (person.person.days as unknown as DayRow[]).filter((d) => d.work_date >= period.from && d.work_date <= period.to);
  // Staff: a fixed salary for the period whatever the attendance, which is listed for the record only.
  const staff = person.kind === 'staff';
  const totals = salaryTotals(rows);
  const figures = salaryRow(person.person, period.from, period.to);
  const ledger = salaryLedger(person.person);
  const query = periodQuery(period);
  const pfMonth = period.from.slice(0, 7);
  const cut = pfCut(person.kind, person.person.pf, pfMonth);

  return (
    <>
      <p className="mb-2 no-print">
        <Link href={`${staff ? '/salary' : '/salary/labour'}?${query}`} className="back"><Icon name="chevronLeft" size={16} /> {t('salary.title')}</Link>
      </p>
      <PeriodBar path={`/salary/${id}`} period={period} today={today} t={t} />
      {asked.error && <p className="banner bad">{t(`labour.errors.${asked.error}`)}</p>}

      <h2 id="money">{t('salary.moneyTitle', { name: person.name })}</h2>
      <p className="muted no-print">{t('salary.moneyLede')}</p>
      <form action={addSalaryMoney.bind(null, id, query)} className="card labour-form no-print">
        <div className="field">
          <label htmlFor="m-date">{t('labour.date')}</label>
          <input id="m-date" type="date" name="date" required defaultValue={today} max={today} />
        </div>
        <div className="field">
          <label htmlFor="m-kind">{t('labour.moneyKind')}</label>
          <select id="m-kind" name="kind" defaultValue="advance">
            <option value="advance">{t('labour.kinds.advance')}</option>
            <option value="deduction">{t('labour.kinds.deduction')}</option>
            <option value="payment">{t('salary.kindPaid')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="m-amount">{t('labour.amount')}</label>
          <RupeesInput input={{ id: 'm-amount', name: 'amount', required: true }} />
        </div>
        <div className="field">
          <label htmlFor="m-method">{t('labour.method')}</label>
          <select id="m-method" name="method" defaultValue="cash">
            <option value="cash">{t('labour.methods.cash')}</option>
            <option value="bank">{t('labour.methods.bank')}</option>
          </select>
          <p className="hint">{t('labour.methodHint')}</p>
        </div>
        <div className="field">
          <label htmlFor="m-note">{t('labour.reason')}</label>
          <input id="m-note" name="note" />
          <p className="hint">{t('labour.reasonHint')}</p>
        </div>
        <div className="labour-form-end"><button type="submit" className="btn">{t('labour.save')}</button></div>
      </form>

      {person.money.length === 0 ? (
        <p className="card empty-state">{t('salary.noMoney')}</p>
      ) : (
        <div className="card table-wrap flush">
          <table className="ledger">
            <thead>
              <tr>
                <th>{t('labour.date')}</th>
                <th>{t('labour.moneyKind')}</th>
                <th className="num">{t('labour.amount')}</th>
                <th>{t('labour.method')}</th>
                <th>{t('labour.reason')}</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {[...person.money].reverse().map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{showDate(l.money_date)}</td>
                  <td>{l.kind === 'payment' ? t('salary.kindPaid') : t(`labour.kinds.${l.kind}`)}</td>
                  <MoneyCell paise={Number(l.amount_paise)} />
                  <td>{l.method ? t(`labour.methods.${l.method}`) : '–'}</td>
                  <td>{l.note}</td>
                  <td className="no-print">
                    <form action={removeSalaryMoney.bind(null, id, l.id, query)}>
                      <button type="submit" className="btn ghost small">{t('labour.remove')}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
          <details className="attendance">
            <summary aria-label={t('salary.showDays')}>
              <span className="att-card"><span className="stat-label">{t('salary.present')}</span><strong>{totals.present}</strong></span>
              <span className="att-card"><span className="stat-label">{t('salary.absent')}</span><strong className={totals.absent ? 'minus' : undefined}>{totals.absent}</strong></span>
              <span className="att-card"><span className="stat-label">{t('salary.otHours')}</span><strong>{totals.otHours || '–'}</strong></span>
              <span className="att-card"><span className="stat-label">{t('salary.salary')}</span><strong>{showPaise(staff ? figures.salary : totals.totalPaise)}</strong></span>
              <span className="att-open">
                <span className="when-closed">{t('salary.showDays')}</span>
                <span className="when-open">{t('salary.hideDays')}</span>
                <Icon name="chevronDown" size={16} />
              </span>
            </summary>
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
                  const dayPart = r.present && !staff ? Number(r.day_pay_paise) : 0;
                  const amount = staff ? 0 : Number(r.amount_paise);
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{showDate(r.work_date)}</td>
                      <td className="wide-only">{siteName.get(r.site_id)}</td>
                      <td><span className={`pill ${r.present ? 'verified' : 'pending'}`} title={t(`report.labour.mark.${r.present ? 'P' : 'A'}`)}>{r.present ? 'P' : 'A'}</span></td>
                      <td className="num">{Number(r.ot_hours) || '–'}</td>
                      <td className="num wide-only">{dayPart ? showPaise(dayPart) : '–'}</td>
                      <td className="num wide-only">{amount - dayPart ? showPaise(amount - dayPart) : '–'}</td>
                      <td className="num">{staff ? '–' : showPaise(amount)}</td>
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
                  <td className="num wide-only">{staff ? '–' : showPaise(totals.dayPaise)}</td>
                  <td className="num wide-only">{!staff && totals.otPaise ? showPaise(totals.otPaise) : '–'}</td>
                  <td className="num"><strong>{showPaise(staff ? figures.salary : totals.totalPaise)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
          </details>
        )}

        <dl className="bill-totals slip-totals">
          {staff ? (
            <div><dt>{t('salary.fixed', { rate: showPaise(Number(person.rate_paise ?? 0)) })}</dt><dd>{showPaise(figures.salary)}</dd></div>
          ) : (
            <>
              <div><dt>{t('salary.forDays', { n: totals.present })}</dt><dd>{showPaise(totals.dayPaise)}</dd></div>
              <div><dt>{t('salary.forOt', { n: totals.otHours })}</dt><dd>{showPaise(totals.otPaise)}</dd></div>
            </>
          )}
          <div><dt>{t('salary.salary')}</dt><dd>{showPaise(figures.salary)}</dd></div>
          <div>
            <dt className="pf-cell">
              {t('salary.pfLess', { rate: pfRate(person.person.pfRates, pfMonth) / 100 })}
              <PfSwitch ids={[id]} month={pfMonth} cut={cut}
                labelOn={t('salary.pfOn', { name: person.name, month: pfMonth })} labelOff={t('salary.pfOff', { name: person.name, month: pfMonth })} />
            </dt>
            <dd>{showPaise(figures.pf)}</dd>
          </div>
          <div><dt>{t('salary.advanceLess')}</dt><dd>{showPaise(figures.advance)}</dd></div>
          <div><dt>{t('salary.deductionLess')}</dt><dd>{showPaise(figures.deduction)}</dd></div>
          <div><dt><strong>{t('salary.net')}</strong></dt><dd><strong>{showPaise(figures.net)}</strong></dd></div>
          {figures.before !== 0 && <div><dt>{t(figures.before > 0 ? 'salary.beforeOwed' : 'salary.beforeExtra')}</dt><dd>{showPaise(figures.before)}</dd></div>}
          <div><dt>{t('salary.paidLess')}</dt><dd>{showPaise(figures.paid)}</dd></div>
          <div>
            <dt><strong>{t(figures.balance < 0 ? 'party.statuses.extra' : 'salary.left')}</strong></dt>
            <dd className={figures.balance < 0 ? 'plus' : figures.balance > 0 ? 'minus' : undefined}><strong>{showPaise(figures.balance)}</strong></dd>
          </div>
        </dl>
        <p className="slip-words"><span className="muted">{t('salary.netInWords')}</span> {rupeesInWords(Math.max(figures.net, 0))}</p>
        <div className="slip-sign">
          <span>{t('salary.signWorker')}</span>
          <span>{t('salary.signOffice')}</span>
        </div>
      </article>

      <h2>{t('labour.ledgerTitle')}</h2>
      {ledger.length === 0 ? (
        <p className="card empty-state">{t('salary.noLedger')}</p>
      ) : (
        <div className="card table-wrap flush">
          <table className="ledger statement">
            <thead>
              <tr>
                <th>{t('labour.month')}</th>
                <th className="num">{t('labour.days')}</th>
                <th className="num">{t('salary.salary')}</th>
                <th className="num">{t('salary.pf')}</th>
                <th className="num">{t('salary.advance')}</th>
                <th className="num">{t('salary.deduction')}</th>
                <th className="num">{t('salary.before')}</th>
                <th className="num">{t('salary.paid')}</th>
                <th className="num">{t('salary.left')}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((m) => (
                <tr key={m.month} className={m.balance < 0 ? 'extra-month' : undefined}>
                  <td className="particulars"><Link href={`/salary/${id}?month=${m.month}`} className="underline">{showMonth(m.month)}</Link></td>
                  <td className="num">{m.days || '–'}</td>
                  <MoneyCell paise={m.salary} />
                  <MoneyCell paise={m.pf} />
                  <MoneyCell paise={m.advance} />
                  <MoneyCell paise={m.deduction} />
                  <BalanceCell paise={m.before} t={t} />
                  <MoneyCell paise={m.paid} />
                  <BalanceCell paise={m.balance} t={t} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
