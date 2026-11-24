import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { PrintButton } from '@/components/print-button';
import { PayPeople } from '@/components/pay-people';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../../../entries/data';
import { BalanceCell, MoneyCell, Stat } from '../../../party/shared';
import { removeFamilyMoney, saveMonth } from '../../actions';
import { payPeople } from '../../../pay/actions';
import { labourFirm, payAccounts } from '../../../pay/data';
import { familyGrid, loadFamilies, pickMonth, showMonth } from '../../data';
import { MonthGrid } from '../../month/month-grid';
import { Icon } from '@/components/icons';

/**
 * One family, paid through its head (a single worker is a family of one): the month as on the monthly entry, the money
 * given to the head with its date, and the family's ledger month by month.
 */
export default async function FamilyPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; error?: string }>;
}) {
  const profile = await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const [{ id }, { month: asked, error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [family] = await loadFamilies(await createClient(), id);
  if (!family) notFound();
  const { head, members, money, opening, ledger, balance } = family;
  const today = todayInIndia();
  const db = await createClient();
  const firm = profile.role === 'labour' ? null : await labourFirm(db);
  const accounts = await payAccounts(db, profile.role, firm?.id);
  const payLeft = family?.balance ?? 0;
  const month = pickMonth(asked, today);
  const { grid, month: thisMonth, left } = familyGrid(family, month);
  const single = members.length === 1;
  const sum = (key: 'salary' | 'addition' | 'deduction' | 'advance' | 'paid') => ledger.reduce((s, m) => s + m[key], 0);
  const moneySum = (kind: string) => money.filter((l) => l.kind === kind).reduce((s, l) => s + Number(l.amount_paise), 0);

  return (
    <>
      <Link href="/labour" className="back no-print"><Icon name="chevronLeft" size={16} /> {t('labour.tabs.workers')}</Link>
      <div className="ledger-head">
        <div>
          <h1>{!single ? t('labour.familyOf', { name: head.name }) : head.name}</h1>
          <p className="muted">
            {!single ? `${t('labour.people', { count: members.length })} · ${members.map((m) => m.name).join(', ')}` : head.skill || t('labour.singleNote')}
          </p>
        </div>
        <div className="day-picker no-print">
          <Link href={`/labour/new?head=${head.id}`} className="btn">{t('labour.addMemberShort')}</Link>
          <Link href={`/labour/family/${head.id}/opening`} className="btn ghost">{t(opening ? 'labour.opening.change' : 'labour.opening.button')}</Link>
          <Link href={`/labour/${head.id}/edit`} className="btn ghost">{t('labour.change')}</Link>
          <PrintButton label={t('ledger.print')} />
        </div>
      </div>
      {error && <p className="banner bad">{t(`labour.errors.${error}`)}</p>}

      <div className="calc" aria-label={t('party.summary')}>
        {opening && <>
          <Stat label={t('labour.opening.short')} value={showPaise(Number(opening.amount_paise))} tone={Number(opening.amount_paise) < 0 ? 'done' : 'owe'}
            note={t('labour.opening.from', { month: showMonth(opening.month.slice(0, 7)) })} />
          <span className="op" aria-hidden="true">+</span>
        </>}
        <Stat label={t('labour.earned')} value={showPaise(sum('salary') + sum('addition'))} />
        <span className="op" aria-hidden="true">−</span>
        <Stat label={t('labour.cuts')} value={showPaise(sum('deduction') + sum('advance'))} note={sum('deduction') ? t('labour.withDeductions', { amount: showPaise(sum('deduction')) }) : undefined} />
        <span className="op" aria-hidden="true">−</span>
        <Stat label={t(single ? 'labour.paid' : 'labour.paidToHead')} value={showPaise(sum('paid'))} />
        <span className="op" aria-hidden="true">=</span>
        {balance < 0
          ? <Stat label={t('party.statuses.extra')} value={showPaise(balance)} tone="done" note={t('labour.extraNote')} />
          : <Stat label={t('party.balance')} value={showPaise(balance)} tone={balance > 0 ? 'owe' : 'done'} note={t(balance > 0 ? (single ? 'party.balanceNote' : 'labour.payHead') : 'party.nothingLeft')} />}
      </div>

      <div className="toolbar">
        <h2>{showMonth(month)}</h2>
        <AutoForm action={`/labour/family/${head.id}`} className="date-filter no-print">
          <label className="muted" htmlFor="family-month-pick">{t('labour.month')}</label>
          <input key={month} id="family-month-pick" type="month" name="month" defaultValue={month} max={today.slice(0, 7)} required />
        </AutoForm>
      </div>
      <p className="muted">{t('labour.familyMonthLede')}</p>
      <MonthGrid key={month} families={[grid]} action={saveMonth.bind(null, month)} />

      <div className="stats">
        <Stat label={t('labour.salaryIn', { month: showMonth(month) })} value={showPaise(thisMonth?.salary ?? 0)} note={t('labour.daysTotal', { days: thisMonth?.days ?? 0 })} />
        <Stat label={t('labour.cuts')} value={showPaise((thisMonth?.advance ?? 0) + (thisMonth?.deduction ?? 0))} />
        <Stat label={t('labour.paidIn', { month: showMonth(month) })} value={showPaise(thisMonth?.paid ?? 0)} />
        {left < 0
          ? <Stat label={t('party.statuses.extra')} value={showPaise(left)} tone="done" note={t('labour.extraNote')} />
          : <Stat label={t('party.balance')} value={showPaise(left)} tone={left > 0 ? 'owe' : 'done'} note={t('labour.leftAfter', { month: showMonth(month) })} />}
      </div>

      <h2 id="money">{t('labour.moneyTitle', { name: head.name })}</h2>
      <div className="no-print">
        {profile.role !== 'labour' && <PayPeople single rows={[{ id: head.id, name: head.name, left: payLeft }]} accounts={accounts} today={today} save={payPeople.bind(null, 'labour')} />}
      </div>

      {money.length === 0 ? (
        <p className="card empty-state">{t('labour.noMoney')}</p>
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
              {[...money].reverse().map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{showDate(l.money_date)}</td>
                  <td>{t(`labour.kinds.${l.kind}`)}</td>
                  <MoneyCell paise={Number(l.amount_paise)} />
                  <td>{l.entry_id && profile.role !== 'labour' ? <Link href={`/entries/${l.entry_id}`} className="underline">{t(`labour.methods.${l.method}`)}</Link> : l.method ? t(`labour.methods.${l.method}`) : '–'}</td>
                  <td>{l.note}</td>
                  <td className="no-print">
                    <form action={removeFamilyMoney.bind(null, head.id, l.id, month)}>
                      <button type="submit" className="btn ghost small">{t('labour.remove')}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>
                  {t('labour.moneyTotals', { paid: showPaise(moneySum('payment')), advance: showPaise(moneySum('advance')) })}
                  {moneySum('deduction') > 0 && ` · ${t('labour.withDeductions', { amount: showPaise(moneySum('deduction')) })}`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <h2>{t('labour.ledgerTitle')}</h2>
      {ledger.length === 0 ? (
        <p className="card empty-state">{t('labour.noFamilyLedger')}</p>
      ) : (
        <div className="card table-wrap flush">
          <table className="ledger statement">
            <thead>
              <tr>
                <th>{t('labour.month')}</th>
                <th className="num">{t('labour.days')}</th>
                <th className="num">{t('labour.otHours')}</th>
                <th className="num">{t('labour.salary')}</th>
                <th className="num">{t('labour.advance')}</th>
                <th className="num">{t('labour.before')}</th>
                <th className="num">{t(single ? 'labour.paid' : 'labour.paidToHead')}</th>
                <th className="num">{t('labour.left')}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((m) => (
                <tr key={m.month} className={m.balance < 0 ? 'extra-month' : undefined}>
                  <td className="particulars">
                    <Link href={`/labour/family/${head.id}?month=${m.month}`} className="underline">{showMonth(m.month)}</Link>
                    {m.opening !== 0 && <span className="ledger-note">{t(m.opening < 0 ? 'labour.opening.inLedgerExtra' : 'labour.opening.inLedgerPay', { amount: showPaise(Math.abs(m.opening)) })}</span>}
                    {m.deduction !== 0 && <span className="ledger-note">{t('labour.withDeductions', { amount: showPaise(m.deduction) })}</span>}
                    {m.addition !== 0 && <span className="ledger-note">{t('labour.otherAdded', { amount: showPaise(m.addition) })}</span>}
                  </td>
                  <td className="num">{m.days}</td>
                  <td className="num">{m.otHours || '–'}</td>
                  <MoneyCell paise={m.salary + m.addition} />
                  <MoneyCell paise={m.advance + m.deduction} />
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
