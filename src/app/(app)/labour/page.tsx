import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { ListLink } from '@/components/list-link';
import { RowFilter } from '@/components/row-filter';
import { requireProfile } from '@/lib/auth';
import { monthPay } from '@/lib/labour';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../entries/data';
import { MoneyCell, Stat } from '../party/shared';
import { loadLabour, pickMonth, showMonth } from './data';

/** Everyone in the labour section: the chosen month's pay, and what is left to pay each person overall. */
export default async function LabourPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireProfile('owner', 'office', 'labour');
  const t = await getTranslations();
  const today = todayInIndia();
  const month = pickMonth((await searchParams).month, today);
  const { settings, people } = await loadLabour(await createClient(), today);
  const rows = people
    .filter((p) => p.is_active || p.ledger.balance !== 0)
    .map((p) => ({ ...p, pay: p.ledger.months.find((m) => m.month === month) ?? monthPay({ ...p, kind: 'worker' }, p.rates, settings, { present: 0, absent: 0, ot_hours: 0 }, month, today) }));
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const toPay = sum((r) => Math.max(r.ledger.balance, 0));
  const extra = sum((r) => Math.max(-r.ledger.balance, 0));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('labour.title')}</h1>
          <p className="lede">{t('labour.lede')}</p>
        </div>
        <Link href="/labour/new" className="btn">{t('labour.addWorker')}</Link>
      </div>

      <div className="stats">
        <Stat label={t('party.balance')} value={showPaise(toPay)} note={t('party.balanceNote')} tone="owe" />
        <Stat label={t('party.statuses.extra')} value={showPaise(extra)} note={t('labour.extraNote')} tone="done" />
        <Stat label={t('labour.earnedIn', { month: showMonth(month) })} value={showPaise(sum((r) => r.pay.earned))} note={t('labour.people', { count: rows.length })} />
        <Stat label={t('labour.pfEsicIn', { month: showMonth(month) })} value={showPaise(sum((r) => r.pay.pf + r.pay.esic))} note={t('labour.pfEsicNote')} />
      </div>

      <div className="toolbar">
        {rows.length > 0 && <RowFilter table="labour" label={t('labour.search')} placeholder={t('labour.searchHint')} none={t('labour.searchNone')} />}
        <AutoForm action="/labour" className="date-filter">
          <label className="muted" htmlFor="labour-month">{t('salary.month')}</label>
          <input key={month} id="labour-month" type="month" name="month" defaultValue={month} max={today.slice(0, 7)} required />
        </AutoForm>
      </div>

      {rows.length === 0 ? (
        <p className="card empty-state">{t('labour.none')}</p>
      ) : (
        <div className="card table-wrap flush hide-when-empty">
          <table className="ledger clickable" id="labour">
            <thead>
              <tr>
                <th>{t('labour.name')}</th>
                <th>{t('labour.type')}</th>
                <th className="num">{t('salary.present')}</th>
                <th className="num">{t('salary.absent')}</th>
                <th className="num">{t('salary.otHours')}</th>
                <th className="num">{t('labour.earned')}</th>
                <th className="num">{t('labour.pf')}</th>
                <th className="num">{t('labour.esic')}</th>
                <th className="num">{t('labour.net')}</th>
                <th className="num">{t('party.balance')}</th>
                <th className="num">{t('party.statuses.extra')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-name={r.name}>
                  <td><ListLink href={`/labour/${r.id}`} className="party-link">{r.name}</ListLink>{r.skill && <span className="muted"> · {r.skill}</span>}</td>
                  <td>{t(`labour.kinds.${r.kind}`)}</td>
                  <td className="num">{r.pay.present}</td>
                  <td className="num">{r.pay.absent}</td>
                  <td className="num">{r.kind === 'staff' ? '–' : r.pay.otHours}</td>
                  <MoneyCell paise={r.pay.earned} />
                  <MoneyCell paise={r.pay.pf} />
                  <MoneyCell paise={r.pay.esic} />
                  <MoneyCell paise={r.pay.net} />
                  <MoneyCell paise={Math.max(r.ledger.balance, 0)} strong tone="minus" />
                  <MoneyCell paise={Math.max(-r.ledger.balance, 0)} strong tone="plus" />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>{t('party.grandTotal')}</td>
                <MoneyCell paise={sum((r) => r.pay.earned)} />
                <MoneyCell paise={sum((r) => r.pay.pf)} />
                <MoneyCell paise={sum((r) => r.pay.esic)} />
                <MoneyCell paise={sum((r) => r.pay.net)} />
                <MoneyCell paise={toPay} strong tone="minus" />
                <MoneyCell paise={extra} strong tone="plus" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
