import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PrintButton } from '@/components/print-button';
import { requireProfile } from '@/lib/auth';
import type { LedgerRow } from '@/lib/labour';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { daysInMonth } from '@/lib/wages';
import { showDate, todayInIndia } from '../../entries/data';
import { BalanceCell, MoneyCell, Stat } from '../../party/shared';
import { addMoney, removeMoney } from '../actions';
import { loadLabour, showMonth } from '../data';

/** One person's account: what they earned, what was cut and paid, what is left, and their attendance month by month. */
export default async function LabourWorkerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const profile = await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const today = todayInIndia();
  const { people } = await loadLabour(await createClient(), today, id);
  const person = people[0];
  if (!person) notFound();
  const { ledger } = person;
  const staff = person.kind === 'staff';
  const cuts = ledger.pf + ledger.esic + ledger.otherCuts;
  const given = ledger.advances + ledger.paid;
  const office = profile.role !== 'labour';
  const mayRemove = (r: Exclude<LedgerRow, { type: 'salary' }>) => office
    || (r.money.created_by === profile.user_id && (r.money.created_at ?? '').slice(0, 10) === today);

  const details = (r: LedgerRow) => {
    if (r.type !== 'salary') {
      const bits = [r.money.method && t(`labour.methods.${r.money.method as 'cash' | 'bank'}`), r.money.reference, r.money.note].filter(Boolean);
      return <><strong>{t(`labour.moneyKinds.${r.type}`)}</strong>{bits.length > 0 && <span className="muted"> · {bits.join(' · ')}</span>}</>;
    }
    const p = r.pay;
    return (
      <>
        <strong>{t('labour.salaryOf', { month: showMonth(p.month) })}</strong>
        <span className="ledger-note">
          {staff
            ? t('labour.staffLine', { rate: showPaise(p.rate), earned: showPaise(p.earned) })
            : t('labour.workerLine', { days: p.present, rate: showPaise(p.rate), hours: p.otHours, ot: showPaise(p.otPaise), earned: showPaise(p.earned) })}
          {t('labour.cutsLine', { pf: showPaise(p.pf), esic: showPaise(p.esic) })}
        </span>
      </>
    );
  };

  return (
    <>
      <Link href="/labour" className="back no-print">◄ {t('labour.tabs.workers')}</Link>
      <div className="ledger-head">
        <div>
          <h1>{person.name}</h1>
          <p className="muted">
            {t(`labour.kinds.${person.kind}`)}{person.skill && ` · ${person.skill}`} · {t('labour.joinedOn', { date: showDate(person.joined_on) })}
            {person.left_on && ` · ${t('labour.leftOn', { date: showDate(person.left_on) })}`}
          </p>
        </div>
        <div className="day-picker no-print">
          <Link href={`/labour/attendance?worker=${person.id}`} className="btn ghost">{t('labour.openCard')}</Link>
          <Link href={`/labour/${person.id}/edit`} className="btn ghost">{t('labour.change')}</Link>
          <PrintButton label={t('ledger.print')} />
        </div>
      </div>
      {error && <p className="banner bad">{t(`labour.errors.${error}`)}</p>}

      <div className="calc" aria-label={t('party.summary')}>
        <Stat label={t('labour.earned')} value={showPaise(ledger.earned)} note={t('labour.earnedNote')} />
        <span className="op" aria-hidden="true">−</span>
        <Stat label={t('labour.cuts')} value={showPaise(cuts)} note={t('labour.cutsNote', { pf: showPaise(ledger.pf), esic: showPaise(ledger.esic), other: showPaise(ledger.otherCuts) })} />
        <span className="op" aria-hidden="true">−</span>
        <Stat label={t('labour.given')} value={showPaise(given)} note={t('labour.givenNote', { advances: showPaise(ledger.advances), paid: showPaise(ledger.paid) })} />
        <span className="op" aria-hidden="true">=</span>
        {ledger.balance < 0
          ? <Stat label={t('party.statuses.extra')} value={showPaise(-ledger.balance)} tone="done" note={t('labour.extraNote')} />
          : <Stat label={t('party.balance')} value={showPaise(ledger.balance)} tone={ledger.balance > 0 ? 'owe' : 'done'} note={t(ledger.balance > 0 ? 'party.balanceNote' : 'party.nothingLeft')} />}
      </div>

      <form action={addMoney.bind(null, person.id)} className="card labour-form no-print">
        <h2 className="labour-form-title">{t('labour.addMoney')}</h2>
        <div className="field">
          <label htmlFor="m-kind">{t('labour.moneyKind')}</label>
          <select id="m-kind" name="kind" defaultValue="advance">
            <option value="advance">{t('labour.moneyKinds.advance')}</option>
            <option value="payment">{t('labour.moneyKinds.payment')}</option>
            <option value="deduction">{t('labour.moneyKinds.deduction')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="m-amount">{t('party.amount')}</label>
          <input id="m-amount" name="amount" inputMode="decimal" required />
        </div>
        <div className="field">
          <label htmlFor="m-date">{t('labour.date')}</label>
          <input id="m-date" type="date" name="money_date" required defaultValue={today} />
        </div>
        <div className="field">
          <label htmlFor="m-method">{t('labour.method')}</label>
          <select id="m-method" name="method" defaultValue="cash">
            <option value="cash">{t('labour.methods.cash')}</option>
            <option value="bank">{t('labour.methods.bank')}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="m-ref">{t('party.reference')}</label>
          <input id="m-ref" name="reference" />
        </div>
        <div className="field">
          <label htmlFor="m-note">{t('labour.note')}</label>
          <input id="m-note" name="note" />
          <p className="hint">{t('labour.noteHint')}</p>
        </div>
        <div className="labour-form-end"><button type="submit" className="btn">{t('labour.save')}</button></div>
      </form>

      <h2>{t('labour.accountTitle')}</h2>
      {ledger.rows.length === 0 ? (
        <p className="card empty-state">{t('labour.noAccount')}</p>
      ) : (
        <div className="card table-wrap flush">
          <table className="ledger statement">
            <thead>
              <tr>
                <th>{t('labour.date')}</th>
                <th>{t('ledger.particulars')}</th>
                <th className="num">{t('labour.salaryAfterCuts')}</th>
                <th className="num">{t('labour.paidOrCut')}</th>
                <th className="num">{t('labour.left_after')}</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((r) => (
                <tr key={r.type === 'salary' ? r.pay.month : r.money.id}>
                  <td className="nowrap">{showDate(r.date)}</td>
                  <td className="particulars">{details(r)}</td>
                  <MoneyCell paise={r.type === 'salary' ? r.pay.net : 0} />
                  <MoneyCell paise={r.type === 'salary' ? 0 : Number(r.money.amount_paise)} />
                  <BalanceCell paise={r.balance} t={t} />
                  <td className="no-print">
                    {r.type !== 'salary' && mayRemove(r) && (
                      <form action={removeMoney.bind(null, person.id, r.money.id)}>
                        <button type="submit" className="btn ghost small">{t('labour.remove')}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>{t('labour.monthsTitle')}</h2>
      {ledger.months.length === 0 ? (
        <p className="card empty-state">{t('labour.noCards')}</p>
      ) : (
        <div className="card table-wrap flush">
          <table className="ledger">
            <thead>
              <tr>
                <th>{t('salary.month')}</th>
                <th className="num">{t('salary.present')}</th>
                <th className="num">{t('salary.absent')}</th>
                <th className="num">{t('labour.notEntered')}</th>
                {!staff && <th className="num">{t('salary.otHours')}</th>}
                <th className="num">{t('labour.earned')}</th>
                <th className="num">{t('labour.pf')}</th>
                <th className="num">{t('labour.esic')}</th>
                <th className="num">{t('labour.net')}</th>
              </tr>
            </thead>
            <tbody>
              {[...ledger.months].reverse().map((p) => {
                const first = `${p.month}-01`;
                const days = today.slice(0, 7) === p.month ? Number(today.slice(8)) : daysInMonth(first);
                return (
                  <tr key={p.month}>
                    <td><Link href={`/labour/attendance?worker=${person.id}&month=${p.month}`} className="underline">{showMonth(p.month)}</Link></td>
                    <td className="num">{p.present}</td>
                    <td className="num">{p.absent}</td>
                    <td className="num">{Math.max(days - p.present - p.absent, 0)}</td>
                    {!staff && <td className="num">{p.otHours}</td>}
                    <MoneyCell paise={p.earned} />
                    <MoneyCell paise={p.pf} />
                    <MoneyCell paise={p.esic} />
                    <MoneyCell paise={p.net} strong />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
