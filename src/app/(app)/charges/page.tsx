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

interface Row {
  entry_id: string; serial: string; entry_type: string; entry_date: string; reference: string; narration: string;
  party_name: string | null; money_account_id: string | null; charges_paise: number | string;
}

/**
 * Money → Bank charges (owner decision 2026-11-28): every charge the bank took, typed with a party payment or on its
 * own, so the bankbook matches the bank statement and the charges can be seen in one place, bank by bank.
 */
export default async function ChargesPage({ searchParams }: { searchParams: Promise<{ account?: string; month?: string }> }) {
  const profile = await requireProfile('owner', 'office');
  const [asked, working, t] = await Promise.all([searchParams, getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const today = todayInIndia();
  const thisMonth = today.slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked.month ?? '') ? asked.month : undefined;
  const db = await createClient();
  let query = db.from('bank_charge_rows')
    .select('entry_id, serial, entry_type, entry_date, reference, narration, party_name, money_account_id, charges_paise')
    .eq('firm_id', firm.id);
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
  const all = (data ?? []).map((r) => ({ ...r, charges: Number(r.charges_paise) }));
  const account = accounts.find((a) => a.id === asked.account);
  const rows = account ? all.filter((r) => r.money_account_id === account.id) : all;
  const total = rows.reduce((s, r) => s + r.charges, 0);
  const takenBy = (id: string) => all.filter((r) => r.money_account_id === id).reduce((s, r) => s + r.charges, 0);
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));
  const link = (a: string | undefined, m: string | undefined) => {
    const q = new URLSearchParams({ ...(a && { account: a }), ...(m && { month: m }) }).toString();
    return `/charges${q ? `?${q}` : ''}`;
  };
  const chip = (href: string, on: boolean, label: string) => <Link key={href} href={href} className={`chip${on ? ' on' : ''}`}>{label}</Link>;

  return (
    <>
      <h1>{t('charges.title')}</h1>
      <p className="lede">{t('charges.lede')}</p>
      <div className="quick-add no-print"><div className="quick-buttons">
        <MoneyPopup mode="out" preset={{ reason: 'bank_charges' }} button={t('charges.add')} firm={firm} account="" owner={profile.role === 'owner'}
          today={today} save={postMoney} accounts={accounts.filter((a) => a.is_active)} people={[]} />
      </div></div>

      <div className="stats">
        <Stat label={account ? t('charges.totalFrom', { account: account.name }) : t('charges.total')} value={showPaise(total)} tone="owe" />
      </div>

      <div className="card report-bar salary-bar no-print">
        <nav className="filters" aria-label={t('charges.account')}>
          {chip(link(undefined, month), !account, t('personal.allAccounts'))}
          {accounts.filter((a) => a.is_active || takenBy(a.id) > 0).map((a) =>
            chip(link(a.id, month), account?.id === a.id, `${a.name} · ${showPaise(takenBy(a.id))}`))}
        </nav>
      </div>
      <div className="card report-bar salary-bar no-print">
        <nav className="filters" aria-label={t('salary.month')}>
          {chip(link(account?.id, undefined), !month, t('gst.all'))}
          {chip(link(account?.id, thisMonth), month === thisMonth, t('salary.thisMonth'))}
          {chip(link(account?.id, lastMonth(thisMonth)), month === lastMonth(thisMonth), t('salary.lastMonth'))}
        </nav>
        <AutoForm action="/charges" className="date-filter">
          {account && <input type="hidden" name="account" value={account.id} />}
          <label className="muted" htmlFor="charges-month">{t('salary.month')}</label>
          <input key={month} id="charges-month" type="month" name="month" defaultValue={month ?? ''} max={thisMonth} required />
        </AutoForm>
      </div>
      {month && <h2>{showMonth(month)}</h2>}

      <div className="card table-wrap flush">
        <table className="ledger">
          <thead>
            <tr>
              <th>{t('ledger.date')}</th>
              <th>{t('charges.for')}</th>
              <th>{t('charges.account')}</th>
              <th>{t('party.entry')}</th>
              <th className="num">{t('charges.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">{t('charges.none')}</td></tr>}
            {rows.map((r) => (
              <tr key={r.entry_id}>
                <td className="nowrap">{showDate(r.entry_date)}</td>
                <td className="particulars">
                  {r.party_name ? t('charges.paying', { name: r.party_name }) : t('charges.onItsOwn')}
                  {r.narration && <span className="muted"> · {r.narration}</span>}
                  {r.reference && <span className="muted"> · {r.reference}</span>}
                </td>
                <td>{r.money_account_id ? nameOf.get(r.money_account_id) ?? '' : ''}</td>
                <td className="nowrap"><ListLink href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</ListLink></td>
                <MoneyCell paise={r.charges} tone="minus" />
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr><td colSpan={4}><strong>{t('charges.total')}</strong></td><MoneyCell paise={total} strong tone="minus" /></tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
