import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { RupeesInput } from '@/components/form';
import { PayPeople } from '@/components/pay-people';
import { PrintButton } from '@/components/print-button';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { pfCut, pfRate, salaryLedger, salaryPeriod, salaryRow } from '@/lib/wages';
import { rupeesInWords } from '@/lib/words';
import { showDate, todayInIndia } from '../../entries/data';
import { showMonth } from '../../labour/data';
import { BalanceCell, MoneyCell } from '../../party/shared';
import { payPeople } from '../../pay/actions';
import { payAccounts } from '../../pay/data';
import { addSalaryMoney, removeSalaryMoney } from '../actions';
import { loadSalaryPeople } from '../data';
import { PeriodBar, periodQuery } from '../period';
import { PfSwitch } from '../pf-switch';

/**
 * One person's salary slip for a period (a worker's: a month, typed on the Skill sheet): PF, advances and deductions taken off;
 * what was left from before, paid and left. Below it, their money lines and their ledger month by month.
 */
export default async function SalarySlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; from?: string; to?: string; error?: string }>;
}) {
  const profile = await requireProfile('owner', 'office');
  const { id } = await params;
  const t = await getTranslations();
  const today = todayInIndia();
  const asked = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await createClient();
  const [person] = await loadSalaryPeople(db, today, id);
  if (!person) notFound();
  // Staff: a fixed salary for the period. A worker's is typed by the month.
  const staff = person.kind === 'staff';
  const period = salaryPeriod(staff ? asked : { month: asked.month ?? asked.from?.slice(0, 7) ?? today.slice(0, 7) }, today);
  const figures = salaryRow(person.person, period.from, period.to);
  const ledger = salaryLedger(person.person);
  // What is left up to this month, offered beside the amount.
  const ledgerLeft = ledger.filter((m) => m.month <= today.slice(0, 7)).at(-1)?.balance ?? 0;
  const working = await getWorkingFirm();
  const accounts = working ? await payAccounts(db, profile.role, working.firm.id) : [];
  const query = periodQuery(period);
  const pfMonth = period.from.slice(0, 7);
  const cut = pfCut(person.kind, person.person.pf, pfMonth);

  return (
    <>
      <div className="page-head no-print">
        <Link href={`${staff ? '/salary' : '/salary/labour'}?${query}`} className="back"><Icon name="chevronLeft" size={16} /> {t('salary.title')}</Link>
        <Link href={`/salary/${id}/opening`} className="btn ghost">{t(person.opening ? 'labour.opening.change' : 'labour.opening.button')}</Link>
      </div>
      <PeriodBar path={`/salary/${id}`} period={period} today={today} t={t} monthOnly={!staff} />
      {asked.error && <p className="banner bad">{t(`labour.errors.${asked.error}`)}</p>}

      <h2 id="money">{t('salary.moneyTitle', { name: person.name })}</h2>
      <p className="muted no-print">{t('salary.moneyLede')}</p>
      <div className="no-print">
        {working && <PayPeople single rows={[{ id, name: person.name, left: ledgerLeft }]} accounts={accounts} today={today} save={payPeople.bind(null, 'salary')} />}
        <details className="tax-paid">
          <summary className="btn ghost">{t('pay.deduction')}</summary>
          <form action={addSalaryMoney.bind(null, id, query)} className="card labour-form">
            <div className="field">
              <label htmlFor="m-date">{t('labour.date')}</label>
              <input id="m-date" type="date" name="date" required defaultValue={today} max={today} />
            </div>
            <div className="field">
              <label htmlFor="m-amount">{t('labour.amount')}</label>
              <RupeesInput input={{ id: 'm-amount', name: 'amount', required: true }} />
            </div>
            <div className="field">
              <label htmlFor="m-note">{t('labour.reason')}</label>
              <input id="m-note" name="note" required />
            </div>
            <div className="labour-form-end"><button type="submit" className="btn">{t('labour.save')}</button></div>
          </form>
        </details>
      </div>

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
                  <td>{l.entry_id ? <Link href={`/entries/${l.entry_id}`} className="underline">{t(`labour.methods.${l.method}`)}</Link> : l.method ? t(`labour.methods.${l.method}`) : '–'}</td>
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
              {/* A worker's rate is the daily report's price, not their pay: never on their slip. */}
              {staff && person.rate_paise !== null && ` · ${showPaise(Number(person.rate_paise))} ${t(`report.labour.per.${person.kind}`)}`}
              {person.phone && ` · ${person.phone}`}
            </p>
          </div>
          <div className="slip-period">
            <p className="muted">{t('salary.periodLabel')}</p>
            <p><strong>{showDate(period.from)} – {showDate(period.to)}</strong></p>
            <PrintButton label={t('salary.print')} />
          </div>
        </header>

        <dl className="bill-totals slip-totals">
          {staff ? (
            <div><dt>{t('salary.fixed', { rate: showPaise(Number(person.rate_paise ?? 0)) })}</dt><dd>{showPaise(figures.salary)}</dd></div>
          ) : (
            <>
              <div>
                <dt>{t('salary.days')} <Link href={`/salary/labour?month=${period.month}#${id}`} className="underline no-print">{t('salary.typeDays')}</Link></dt>
                <dd>{figures.days || '–'}</dd>
              </div>
              <div><dt>{t('salary.otHours')}</dt><dd>{figures.otHours || '–'}</dd></div>
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
                {!staff && <th className="num">{t('salary.days')}</th>}
                {!staff && <th className="num">{t('salary.otHours')}</th>}
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
                  <td className="particulars">
                    <Link href={`/salary/${id}?month=${m.month}`} className="underline">{showMonth(m.month)}</Link>
                    {m.opening !== 0 && <span className="ledger-note">{t(m.opening < 0 ? 'labour.opening.inLedgerExtra' : 'labour.opening.inLedgerPay', { amount: showPaise(Math.abs(m.opening)) })}</span>}
                  </td>
                  {!staff && <td className="num">{m.days || '–'}</td>}
                  {!staff && <td className="num">{m.otHours || '–'}</td>}
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
