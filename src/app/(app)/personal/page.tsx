import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { ListLink } from '@/components/list-link';
import { MoneyPopup } from '@/components/money-popup';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { lastMonth, salaryPeriod } from '@/lib/wages';
import { loadAccounts } from '../bankbook/data';
import { postMoney } from '../entries/actions';
import { showDate, todayInIndia } from '../entries/data';
import { showMonth } from '../labour/data';
import { MoneyCell, Stat } from '../party/shared';

interface Row { entry_id: string; serial: string; entry_date: string; money_account_id: string; narration: string; reference: string; amount_paise: number | string }

/** Money → Personal expenses (owner decision 2026-11-27): every rupee the owner took out for personal use, account by account. */
export default async function PersonalPage({ searchParams }: { searchParams: Promise<{ account?: string; month?: string }> }) {
  await requireProfile('owner');
  const [asked, working, t] = await Promise.all([searchParams, getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const today = todayInIndia();
  const thisMonth = today.slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked.month ?? '') ? asked.month : undefined;
  const db = await createClient();
  let query = db.from('money_rows').select('entry_id, serial, entry_date, money_account_id, narration, reference, amount_paise')
    .eq('firm_id', firm.id).eq('entry_type', 'owner_drawing');
  if (month) {
    const { from, to } = salaryPeriod({ month }, today);
    query = query.gte('entry_date', from).lte('entry_date', to);
  }
  // ponytail: the newest 1000 of a firm; page through them if one ever has more.
  const [{ data, error }, everything] = await Promise.all([
    query.order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000).returns<Row[]>(),
    loadAccounts(db),
  ]);
  if (error) throw new Error(error.message);
  const accounts = everything.filter((a) => a.firm_id === firm.id);
  const all = (data ?? []).map((r) => ({ ...r, spent: -Number(r.amount_paise) }));
  const account = accounts.find((a) => a.id === asked.account);
  const rows = account ? all.filter((r) => r.money_account_id === account.id) : all;
  const total = rows.reduce((s, r) => s + r.spent, 0);
  const spentFrom = (id: string) => all.filter((r) => r.money_account_id === id).reduce((s, r) => s + r.spent, 0);
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const link = (a: string | undefined, m: string | undefined) => {
    const q = new URLSearchParams({ ...(a && { account: a }), ...(m && { month: m }) }).toString();
    return `/personal${q ? `?${q}` : ''}`;
  };
  const chip = (href: string, on: boolean, label: string) => <Link key={href} href={href} className={`chip${on ? ' on' : ''}`}>{label}</Link>;

  return (
    <>
      <h1>{t('personal.title')}</h1>
      <p className="lede">{t('personal.lede')}</p>
      <div className="quick-add no-print"><div className="quick-buttons">
        <MoneyPopup mode="out" personal button={t('bankbook.buttons.personal')} firm={firm} account="" owner today={today} save={postMoney}
          accounts={accounts.filter((a) => a.is_active)} people={[]} />
      </div></div>

      <div className="stats">
        <Stat label={account ? t('personal.totalFrom', { account: account.name }) : t('personal.total')} value={showPaise(total)} tone="owe" />
      </div>

      <div className="card report-bar salary-bar no-print">
        <nav className="filters" aria-label={t('personal.account')}>
          {chip(link(undefined, month), !account, t('personal.allAccounts'))}
          {accounts.filter((a) => a.is_active || spentFrom(a.id) > 0).map((a) =>
            chip(link(a.id, month), account?.id === a.id, `${a.name} · ${showPaise(spentFrom(a.id))}`))}
        </nav>
      </div>
      <div className="card report-bar salary-bar no-print">
        <nav className="filters" aria-label={t('salary.month')}>
          {chip(link(account?.id, undefined), !month, t('gst.all'))}
          {chip(link(account?.id, thisMonth), month === thisMonth, t('salary.thisMonth'))}
          {chip(link(account?.id, lastMonth(thisMonth)), month === lastMonth(thisMonth), t('salary.lastMonth'))}
        </nav>
        <AutoForm action="/personal" className="date-filter">
          {account && <input type="hidden" name="account" value={account.id} />}
          <label className="muted" htmlFor="personal-month">{t('salary.month')}</label>
          <input key={month} id="personal-month" type="month" name="month" defaultValue={month ?? ''} max={thisMonth} required />
        </AutoForm>
      </div>
      {month && <h2>{showMonth(month)}</h2>}

      <div className="card table-wrap flush">
        <table className="ledger">
          <thead>
            <tr>
              <th>{t('ledger.date')}</th>
              <th>{t('personal.spentOn')}</th>
              <th>{t('personal.account')}</th>
              <th>{t('party.entry')}</th>
              <th className="num">{t('personal.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">{t('personal.none')}</td></tr>}
            {rows.map((r) => (
              <tr key={r.entry_id}>
                <td className="nowrap">{showDate(r.entry_date)}</td>
                <td className="particulars">{r.narration || <span className="muted">{t('personal.noNote')}</span>}{r.reference && <span className="muted"> · {r.reference}</span>}</td>
                <td>{nameOf.get(r.money_account_id) ?? ''}</td>
                <td className="nowrap"><ListLink href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</ListLink></td>
                <MoneyCell paise={r.spent} tone="minus" />
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr><td colSpan={4}><strong>{t('personal.total')}</strong></td><MoneyCell paise={total} strong tone="minus" /></tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
