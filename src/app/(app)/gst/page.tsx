import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { TaxPaid } from '@/components/tax-paid';
import { AutoForm } from '@/components/auto-form';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { gstLeft } from '@/lib/tax';
import { lastMonth } from '@/lib/wages';
import { loadNames, showDate, todayInIndia } from '../entries/data';
import { showMonth } from '../labour/data';
import { payAccounts } from '../pay/data';
import { MoneyCell } from '../party/shared';

interface GstRow {
  entry_id: string;
  firm_id: string;
  serial: string;
  entry_type: 'vendor_bill' | 'client_bill';
  entry_date: string;
  reference: string;
  party_id: string | null;
  /** Another of our firms, for labour or a machine supplied between them. */
  counter_firm_id: string | null;
  base_paise: number | string;
  gst_paise: number | string;
}

/**
 * The GST record for the working firm, like the TDS record: every bill with GST. GST on party bills is ours to claim
 * back; GST on our bills to clients is owed to the government. What is left to pay is the one less the other.
 */
export default async function GstPage({ searchParams }: { searchParams: Promise<{ month?: string; firms?: string; taxError?: string }> }) {
  const profile = await requireProfile('owner', 'office');
  const [working, t, asked] = await Promise.all([getWorkingFirm(), getTranslations(), searchParams]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  // A month ("2026-11") shows that month's bills and totals, as GST is filed month by month; none shows every bill.
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked.month ?? '') ? asked.month : undefined;
  const thisMonth = todayInIndia().slice(0, 7);
  const all = profile.role === 'owner' && asked.firms === 'all';
  const db = await createClient();
  const today = todayInIndia();
  let query = db.from('gst_rows').select('*');
  if (!all) query = query.eq('firm_id', working.firm.id);
  if (month) query = query.gte('entry_date', `${month}-01`).lt('entry_date', `${nextMonth(month)}-01`);
  // Paid counts in the month it is for, which is not the month it was paid in.
  let paidQuery = db.from('tax_rows').select('firm_id, amount_paise').eq('account', 'gst_paid');
  if (month) paidQuery = paidQuery.eq('month', month);
  // ponytail: 1000 bills at most are read at once; add totals in the database when a firm passes that with no month chosen.
  const [{ data }, { data: paidRows }, names, accounts] = await Promise.all([
    query.order('entry_date').order('serial').returns<GstRow[]>(),
    paidQuery.returns<{ firm_id: string; amount_paise: number | string }[]>(),
    loadNames(db),
    payAccounts(db, profile.role, working.firm.id),
  ]);
  const rows = data ?? [];
  const taxOf = (firmId: string) => {
    const total = (type: GstRow['entry_type']) => rows.filter((r) => r.firm_id === firmId && r.entry_type === type).reduce((sum, r) => sum + Number(r.gst_paise), 0);
    const tax = { owed: total('client_bill'), claim: total('vendor_bill'), paid: (paidRows ?? []).filter((p) => p.firm_id === firmId).reduce((sum, p) => sum + Number(p.amount_paise), 0) };
    return { ...tax, ...gstLeft(tax) };
  };
  const firms = (all ? working.firms : [working.firm]).map((f) => ({ ...f, ...taxOf(f.id) }));
  const mine = taxOf(working.firm.id);
  const sum = (key: 'owed' | 'claim' | 'paid' | 'toPay' | 'credit') => firms.reduce((total, f) => total + f[key], 0);
  const link = (m: string | undefined, f = all) => `/gst?${[m && `month=${m}`, f && 'firms=all'].filter(Boolean).join('&')}`;

  return (
    <>
      <h1>{t('gst.title')}</h1>
      <p className="lede">{t('gst.lede')}</p>
      {asked.taxError && <p className="banner bad" role="alert">{asked.taxError}</p>}
      <div className="card report-bar salary-bar no-print">
        {profile.role === 'owner' && <nav className="filters" aria-label={t('bankbook.show')}>
          <Link href={link(month, false)} className={`chip${all ? '' : ' on'}`}>{working.firm.name}</Link>
          <Link href={link(month, true)} className={`chip${all ? ' on' : ''}`}>{t('bankbook.allFirms')}</Link>
        </nav>}
        <nav className="filters" aria-label={t('salary.month')}>
          <Link href={link(undefined)} className={`chip${month ? '' : ' on'}`}>{t('gst.all')}</Link>
          <Link href={link(thisMonth)} className={`chip${month === thisMonth ? ' on' : ''}`}>{t('salary.thisMonth')}</Link>
          <Link href={link(lastMonth(thisMonth))} className={`chip${month === lastMonth(thisMonth) ? ' on' : ''}`}>{t('salary.lastMonth')}</Link>
        </nav>
        <AutoForm action="/gst" className="date-filter">
          {all && <input type="hidden" name="firms" value="all" />}
          <label className="muted" htmlFor="gst-month">{t('salary.month')}</label>
          <input key={month} id="gst-month" type="month" name="month" defaultValue={month ?? ''} max={thisMonth} required />
        </AutoForm>
      </div>
      {month && <h2>{showMonth(month)}</h2>}
      {all ? (
        <div className="card table-wrap flush">
          <table className="ledger">
            <thead><tr><th>{t('fields.firm_id')}</th><th className="num">{t('tax.owedShort')}</th><th className="num">{t('tax.claimShort')}</th><th className="num">{t('tax.paid')}</th><th className="num">{t('gst.toPay')}</th><th className="num">{t('gst.credit')}</th></tr></thead>
            <tbody>{firms.map((f) => (
              <tr key={f.id}><td>{f.name}</td><MoneyCell paise={f.owed} /><MoneyCell paise={f.claim} /><MoneyCell paise={f.paid} /><MoneyCell paise={f.toPay} strong tone="minus" /><MoneyCell paise={f.credit} strong tone="plus" /></tr>
            ))}</tbody>
            <tfoot><tr><td>{t('bankbook.total')}</td><MoneyCell paise={sum('owed')} /><MoneyCell paise={sum('claim')} /><MoneyCell paise={sum('paid')} /><MoneyCell paise={sum('toPay')} strong tone="minus" /><MoneyCell paise={sum('credit')} strong tone="plus" /></tr></tfoot>
          </table>
        </div>
      ) : (
        <>
          <dl className="bill-totals">
            <div><dt>{t('gst.owed')}</dt><dd className={mine.owed ? 'minus' : undefined}>{showPaise(mine.owed)}</dd></div>
            <div><dt>{t('gst.toClaim')}</dt><dd className={mine.claim ? 'plus' : undefined}>{showPaise(mine.claim)}</dd></div>
            <div><dt>{t('tax.paid')}</dt><dd>{showPaise(mine.paid)}</dd></div>
            <div className="grand">
              <dt>{t(mine.credit ? 'gst.credit' : 'gst.toPay')}</dt>
              <dd className={mine.credit ? 'plus' : mine.toPay ? 'minus' : undefined}>{showPaise(mine.credit || mine.toPay)}</dd>
            </div>
          </dl>
          <TaxPaid reason="gst_paid" month={month ?? lastMonth(thisMonth)} left={month ? mine.toPay : 0} accounts={accounts} today={today} back={link(month)} />
        </>
      )}
      {all && <p className="hint">{t('tax.notNetted')}</p>}
      {rows.length === 0 ? (
        <p className="empty">{t(month ? 'gst.noneInMonth' : 'gst.none')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('tds.date')}</th>{all && <th>{t('fields.firm_id')}</th>}
                <th>{t('tds.bill')}</th>
                <th>{t('tds.party')}</th>
                <th>{t('gst.kind')}</th>
                <th className="num">{t('tds.base')}</th>
                <th className="num">{t('tds.rate')}</th>
                <th className="num">{t('gst.amount')}</th>
                <th className="num">{t('gst.billTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [base, gst] = [Number(r.base_paise), Number(r.gst_paise)];
                return (
                  <tr key={`${r.entry_id}${r.firm_id}`}>
                    <td className="whitespace-nowrap">{showDate(r.entry_date)}</td>{all && <td>{names.firms.get(r.firm_id)}</td>}
                    <td>
                      <Link href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</Link>{' '}
                      <span className="muted">{r.reference}</span>
                    </td>
                    <td>{(r.counter_firm_id ? names.firms.get(r.counter_firm_id) : names.parties.get(r.party_id ?? '')) ?? '?'}</td>
                    <td>{t(r.entry_type === 'vendor_bill' ? 'gst.input' : 'gst.output')}</td>
                    <td className="num">{showPaise(base)}</td>
                    <td className="num">{base ? `${Math.round((gst * 10_000) / base) / 100}%` : '–'}</td>
                    <td className={`num ${r.entry_type === 'vendor_bill' ? 'plus' : 'minus'}`}>{showPaise(gst)}</td>
                    <td className="num">{showPaise(base + gst)}</td>
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

/** The month after "2026-12": "2027-01". */
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
