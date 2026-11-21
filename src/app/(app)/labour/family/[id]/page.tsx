import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { RupeesInput } from '@/components/form';
import { PrintButton } from '@/components/print-button';
import { requireProfile } from '@/lib/auth';
import { rateFor } from '@/lib/labour';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../../../entries/data';
import { BalanceCell, MoneyCell, Stat } from '../../../party/shared';
import { addFamilyMoney, removeFamilyMoney, saveMonth } from '../../actions';
import { loadFamilies, pickMonth, showMonth } from '../../data';
import { MonthGrid, type GridRow } from '../../month/month-grid';
import { Icon } from '@/components/icons';

const box = (value: number | undefined) => (value ? String(value) : '');
const rupeeBox = (paise: number | undefined) => (paise ? String(paise / 100) : '');

/**
 * One family, paid through its head: each member's days for the month at their own salary, the money given to the head
 * with its date, and the family's ledger month by month.
 */
export default async function FamilyPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; error?: string }>;
}) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const [{ id }, { month: asked, error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [family] = await loadFamilies(await createClient(), id);
  if (!family) notFound();
  const { head, members, money, ledger, balance } = family;
  const today = todayInIndia();
  const month = pickMonth(asked, today);
  const thisMonth = ledger.find((m) => m.month === month);
  const before = ledger.filter((m) => m.month < month).at(-1)?.balance ?? 0;
  const left = thisMonth?.balance ?? before;
  const sum = (key: 'salary' | 'addition' | 'deduction' | 'advance' | 'paid') => ledger.reduce((s, m) => s + m[key], 0);
  const moneySum = (kind: string) => money.filter((l) => l.kind === kind).reduce((s, l) => s + Number(l.amount_paise), 0);

  const rows: GridRow[] = members.filter((m) => m.is_active || m.months.some((x) => x.month.startsWith(month))).map((m) => {
    const mine = m.ledger.find((l) => l.month === month);
    return {
      id: m.id, name: m.name, skill: m.id === head.id ? t('labour.head') : m.skill, rate: rateFor(m.rates, month), before: 0,
      // Money typed for them before they joined the family rides along unseen, so saving their days keeps it.
      days: box(mine?.days), ot: box(mine?.otHours), advance: rupeeBox(mine?.advance), deduction: rupeeBox(mine?.deduction),
      addition: rupeeBox(mine?.addition), paid: rupeeBox(mine?.paid), note: mine?.note ?? '',
    };
  });

  return (
    <>
      <Link href="/labour/family" className="back no-print"><Icon name="chevronLeft" size={16} /> {t('labour.tabs.families')}</Link>
      <div className="ledger-head">
        <div>
          <h1>{t('labour.familyOf', { name: head.name })}</h1>
          <p className="muted">{t('labour.people', { count: members.length })} · {members.map((m) => m.name).join(', ')}</p>
        </div>
        <div className="day-picker no-print">
          <Link href={`/labour/new?head=${head.id}`} className="btn">{t('labour.addMemberShort')}</Link>
          <Link href={`/labour/${head.id}/edit`} className="btn ghost">{t('labour.change')}</Link>
          <PrintButton label={t('ledger.print')} />
        </div>
      </div>
      {error && <p className="banner bad">{t(`labour.errors.${error}`)}</p>}

      <div className="calc" aria-label={t('party.summary')}>
        <Stat label={t('labour.earned')} value={showPaise(sum('salary') + sum('addition'))} />
        <span className="op" aria-hidden="true">−</span>
        <Stat label={t('labour.cuts')} value={showPaise(sum('deduction') + sum('advance'))} note={t('labour.cutsNote', { deduction: showPaise(sum('deduction')), advance: showPaise(sum('advance')) })} />
        <span className="op" aria-hidden="true">−</span>
        <Stat label={t('labour.paidToHead')} value={showPaise(sum('paid'))} />
        <span className="op" aria-hidden="true">=</span>
        {balance < 0
          ? <Stat label={t('party.statuses.extra')} value={showPaise(balance)} tone="done" note={t('labour.extraNote')} />
          : <Stat label={t('party.balance')} value={showPaise(balance)} tone={balance > 0 ? 'owe' : 'done'} note={t(balance > 0 ? 'labour.payHead' : 'party.nothingLeft')} />}
      </div>

      <div className="toolbar">
        <h2>{t('labour.daysIn', { month: showMonth(month) })}</h2>
        <AutoForm action={`/labour/family/${head.id}`} className="date-filter no-print">
          <label className="muted" htmlFor="family-month-pick">{t('labour.month')}</label>
          <input key={month} id="family-month-pick" type="month" name="month" defaultValue={month} max={today.slice(0, 7)} required />
        </AutoForm>
      </div>
      <p className="muted">{t('labour.familyMonthLede')}</p>
      <MonthGrid key={month} rows={rows} action={saveMonth.bind(null, month)} daysOnly />

      <div className="stats">
        <Stat label={t('labour.salaryIn', { month: showMonth(month) })} value={showPaise(thisMonth?.salary ?? 0)} note={t('labour.daysTotal', { days: thisMonth?.days ?? 0 })} />
        <Stat label={t('labour.cuts')} value={showPaise((thisMonth?.advance ?? 0) + (thisMonth?.deduction ?? 0))} />
        <Stat label={t('labour.paidIn', { month: showMonth(month) })} value={showPaise(thisMonth?.paid ?? 0)} />
        {left < 0
          ? <Stat label={t('party.statuses.extra')} value={showPaise(left)} tone="done" note={t('labour.extraNote')} />
          : <Stat label={t('party.balance')} value={showPaise(left)} tone={left > 0 ? 'owe' : 'done'} note={t('labour.leftAfter', { month: showMonth(month) })} />}
      </div>

      <h2 id="money">{t('labour.moneyTitle', { name: head.name })}</h2>
      <form action={addFamilyMoney.bind(null, head.id)} className="card labour-form no-print">
        <div className="field">
          <label htmlFor="m-date">{t('labour.date')}</label>
          <input id="m-date" type="date" name="date" required defaultValue={today} max={today} />
        </div>
        <div className="field">
          <label htmlFor="m-kind">{t('labour.moneyKind')}</label>
          <select id="m-kind" name="kind" defaultValue="payment">
            <option value="payment">{t('labour.kinds.payment')}</option>
            <option value="advance">{t('labour.kinds.advance')}</option>
            <option value="deduction">{t('labour.kinds.deduction')}</option>
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
                  <td>{l.method ? t(`labour.methods.${l.method}`) : '–'}</td>
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
                  {t('labour.moneyTotals', { paid: showPaise(moneySum('payment')), advance: showPaise(moneySum('advance')), deduction: showPaise(moneySum('deduction')) })}
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
                <th className="num">{t('labour.deduction')}</th>
                <th className="num">{t('labour.before')}</th>
                <th className="num">{t('labour.paidToHead')}</th>
                <th className="num">{t('labour.left')}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((m) => (
                <tr key={m.month} className={m.balance < 0 ? 'extra-month' : undefined}>
                  <td className="particulars"><Link href={`/labour/family/${head.id}?month=${m.month}`} className="underline">{showMonth(m.month)}</Link></td>
                  <td className="num">{m.days}</td>
                  <td className="num">{m.otHours || '–'}</td>
                  <MoneyCell paise={m.salary + m.addition} />
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
