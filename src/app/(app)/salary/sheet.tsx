import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { RowFilter } from '@/components/row-filter';
import { TaxPaid } from '@/components/tax-paid';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { payPerDay, pfCut, salaryPeriod, salaryRow, type PersonKind } from '@/lib/wages';
import { showDate, todayInIndia } from '../entries/data';
import { BalanceCell, MoneyCell } from '../party/shared';
import { payAccounts } from '../pay/data';
import { saveSalaryMonth } from './actions';
import { loadSalaryPeople } from './data';
import { MonthCells, MonthForm } from './month-cells';
import { PeriodBar, periodQuery } from './period';
import { PfSwitch } from './pf-switch';

const PATH: Record<PersonKind, string> = { staff: '/salary', worker: '/salary/labour' };

/**
 * The Salary sheet for staff over a period, or for labour (whose days, OT and salary are typed here) over a month: what each earned, PF cut (switched per person, or for everyone),
 * advances and deductions taken off, what was left from before, what was paid and what is left. A name opens their
 * slip and ledger.
 */
export async function SalarySheet({ kind, searchParams }: { kind: PersonKind; searchParams: Promise<{ month?: string; from?: string; to?: string; error?: string; taxError?: string }> }) {
  const profile = await requireProfile('owner', 'office');
  const t = await getTranslations();
  const today = todayInIndia();
  const asked = await searchParams;
  const labour = kind === 'worker';
  // Labour is typed by the month.
  const period = salaryPeriod(labour ? { month: asked.month ?? asked.from?.slice(0, 7) ?? today.slice(0, 7) } : asked, today);
  const query = periodQuery(period);
  const path = PATH[kind];
  const pfMonth = period.from.slice(0, 7);
  const inPeriod = (date: string) => date >= period.from && date <= period.to;

  // PF is cut month by month, so what was deposited is shown beside it for a whole month only. Staff and skill workers
  // are deposited together, so it is every firm's deposit for the month.
  const db = await createClient();
  const working = await getWorkingFirm();
  const [accounts, taxes] = await Promise.all([
    working ? payAccounts(db, profile.role, working.firm.id) : [],
    period.month ? db.from('tax_rows').select('amount_paise').eq('account', 'pf_paid').eq('month', period.month) : null,
  ]);
  const pfPaid = taxes ? (taxes.data ?? []).reduce((s, r) => s + Number(r.amount_paise), 0) : null;
  const rows = (await loadSalaryPeople(db, today))
    .filter((p) => p.kind === kind)
    .map((p) => ({ ...p, ...salaryRow(p.person, period.from, period.to), cut: pfCut(p.kind, p.person.pf, pfMonth) }))
    // Everyone on the list, and anyone else with money left either way.
    .filter((r) => (r.is_active && (labour || r.rate_paise !== null))
      || r.salary !== 0 || r.money.some((m) => inPeriod(m.money_date))
      || r.before !== 0 || r.balance !== 0);
  const sum = (key: 'days' | 'otHours' | 'salary' | 'pf' | 'advance' | 'deduction' | 'net' | 'paid') => rows.reduce((s, r) => s + r[key], 0);
  // To pay and extra paid are kept apart in totals, never netted off against each other.
  const toPay = (key: 'before' | 'balance') => rows.reduce((s, r) => s + Math.max(r[key], 0), 0);
  const extra = rows.reduce((s, r) => s + Math.min(r.balance, 0), 0);
  const allCut = rows.length > 0 && rows.every((r) => r.cut);
  const table = (
    <div className="card table-wrap flush">
      <table id="salary-sheet" className={`ledger salary-table salary-sheet${labour ? ' skill-sheet' : ''}`}>
        <thead>
          <tr>
            <th>{t('salary.name')}</th>
            {labour && <th className="num">{t('salary.perDay')}</th>}
            {labour && <th className="num">{t('salary.days')}</th>}
            {labour && <th className="num">{t('salary.otHours')}</th>}
            <th className="num">{t('salary.salary')}</th>
            <th className="num">
              <span className="pf-cell">
                {t('salary.pf')}
                <PfSwitch ids={rows.map((r) => r.id)} month={pfMonth} cut={allCut}
                  labelOn={t('salary.pfOnAll', { month: pfMonth })} labelOff={t('salary.pfOffAll', { month: pfMonth })} />
              </span>
            </th>
            <th className="num">{t('salary.advance')}</th>
            <th className="num">{t('salary.deduction')}</th>
            <th className="num">{t('salary.net')}</th>
            <th className="num">{t('salary.before')}</th>
            <th className="num">{t('salary.paid')}</th>
            <th className="num">{t('salary.left')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} id={r.id} data-name={r.name}>
              <td>
                <Link href={`/salary/${r.id}?${query}`} className="underline"><strong>{r.name}</strong></Link>
                {!r.is_active && <span className="pill common small-pill">{t('salary.inactive')}</span>}
              </td>
              {labour ? (
                <MonthCells key={`${period.month}/${r.days}/${r.otHours}/${r.salary}/${payPerDay(r.person.months, pfMonth)}`} id={r.id} name={r.name}
                  pay={payPerDay(r.person.months, pfMonth)} days={r.days} ot={r.otHours} salary={r.salary} />
              ) : <MoneyCell paise={r.salary} />}
              <td className="num">
                <span className="pf-cell">
                  {r.pf ? showPaise(r.pf) : <span className="muted">–</span>}
                  <PfSwitch ids={[r.id]} month={pfMonth} cut={r.cut}
                    labelOn={t('salary.pfOn', { name: r.name, month: pfMonth })} labelOff={t('salary.pfOff', { name: r.name, month: pfMonth })} />
                </span>
              </td>
              <MoneyCell paise={r.advance} />
              <MoneyCell paise={r.deduction} />
              <MoneyCell paise={r.net} strong />
              <BalanceCell paise={r.before} t={t} />
              <MoneyCell paise={r.paid} />
              <BalanceCell paise={r.balance} t={t} />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{t('salary.total')}</td>
            {labour && <td />}
            {labour && <td className="num">{sum('days') || '–'}</td>}
            {labour && <td className="num">{sum('otHours') || '–'}</td>}
            <MoneyCell paise={sum('salary')} />
            <MoneyCell paise={sum('pf')} />
            <MoneyCell paise={sum('advance')} />
            <MoneyCell paise={sum('deduction')} />
            <MoneyCell paise={sum('net')} strong />
            <BalanceCell paise={toPay('before')} t={t} />
            <MoneyCell paise={sum('paid')} />
            <BalanceCell paise={toPay('balance')} t={t} />
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <>
      <div className="page-head">
        <h1>{t('salary.title')}</h1>
        <Link href={`/salary/pay?kind=${kind}`} className="btn no-print">{t('pay.salaryButton')}</Link>
      </div>
      <nav className="subnav no-print" aria-label={t('salary.title')}>
        {(['staff', 'worker'] as const).map((k) => (
          <Link key={k} href={`${PATH[k]}?${query}`} className="nav-link" aria-current={k === kind ? 'page' : undefined}>
            {t(k === 'staff' ? 'salary.staff' : 'salary.labour')}
          </Link>
        ))}
      </nav>
      <p className="lede">{t(kind === 'staff' ? 'salary.ledeStaff' : 'salary.ledeLabour')}</p>
      {asked.taxError && <p className="banner bad" role="alert">{asked.taxError}</p>}
      {asked.error && <p className="banner bad">{t(`labour.errors.${asked.error}`)}</p>}
      <PeriodBar path={path} period={period} today={today} t={t} monthOnly={labour} />
      <p className="muted">{t('salary.showing', { from: showDate(period.from), to: showDate(period.to) })}</p>
      <dl className="bill-totals">
        <div><dt>{t('salary.salary')}</dt><dd>{showPaise(sum('salary'))}</dd></div>
        <div><dt>{t('salary.pf')}</dt><dd>{showPaise(sum('pf'))}</dd></div>
        {pfPaid !== null && <div><dt>{t('tax.pfPaid')}</dt><dd>{showPaise(pfPaid)}</dd></div>}
        <div><dt>{t('salary.cuts')}</dt><dd>{showPaise(sum('advance') + sum('deduction'))}</dd></div>
        <div><dt>{t('salary.paid')}</dt><dd>{showPaise(sum('paid'))}</dd></div>
        <div><dt>{t('salary.left')}</dt><dd>{showPaise(toPay('balance'))}</dd></div>
        {extra < 0 && <div><dt>{t('party.statuses.extra')}</dt><dd className="plus">{showPaise(extra)}</dd></div>}
      </dl>
      {pfPaid !== null && working && <TaxPaid reason="pf_paid" month={pfMonth} left={0} accounts={accounts} today={today} back={`${path}?${query}`} />}
      {pfPaid !== null && <p className="hint">{t('tax.pfHint')}</p>}
      {rows.length === 0 ? (
        <p className="card empty-state">{t('salary.none')}</p>
      ) : labour ? (
        <>
          <div className="toolbar no-print"><RowFilter table="salary-sheet" label={t('labour.search')} placeholder={t('labour.searchHint')} none={t('labour.searchNone')} /></div>
          <MonthForm key={period.month} action={saveSalaryMonth.bind(null, period.month!)}>{table}</MonthForm>
        </>
      ) : table}
    </>
  );
}
