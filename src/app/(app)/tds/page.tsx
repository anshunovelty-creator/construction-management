import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { TaxPaid } from '@/components/tax-paid';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { lastMonth } from '@/lib/wages';
import { loadNames, showDate, todayInIndia } from '../entries/data';
import { MoneyCell } from '../party/shared';
import { payAccounts } from '../pay/data';

interface TdsRow {
  entry_id: string;
  firm_id: string;
  serial: string;
  entry_type: 'vendor_bill' | 'client_bill';
  entry_date: string;
  reference: string;
  party_id: string | null;
  /** Another of our firms, for labour or a machine supplied between them. */
  counter_firm_id: string | null;
  section: string;
  rate_bp: number;
  base_paise: number | string;
  tds_paise: number | string;
}

/**
 * The TDS record for the working firm: every bill with TDS, with its rate, section and the amount.
 * TDS we deducted from vendors is owed to the government; TDS clients deducted from our bills can be claimed back.
 */
export default async function TdsPage({ searchParams }: { searchParams: Promise<{ taxError?: string }> }) {
  const profile = await requireProfile('owner', 'office');
  const [working, t, asked] = await Promise.all([getWorkingFirm(), getTranslations(), searchParams]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const db = await createClient();
  const today = todayInIndia();
  const query = db.from('tds_rows').select('*').eq('firm_id', working.firm.id);
  const [{ data }, { data: taxes }, names, accounts] = await Promise.all([
    query.order('entry_date').order('serial').returns<TdsRow[]>(),
    db.from('tax_rows').select('firm_id, account, amount_paise').in('account', ['tds_paid', 'tds_claimed']).returns<{ firm_id: string; account: string; amount_paise: number | string }[]>(),
    loadNames(db),
    payAccounts(db, profile.role, working.firm.id),
  ]);
  const rows = data ?? [];
  const firms = [working.firm].map((f) => {
    const total = (type: TdsRow['entry_type']) => rows.filter((r) => r.firm_id === f.id && r.entry_type === type).reduce((sum, r) => sum + Number(r.tds_paise), 0);
    const tax = (account: string) => (taxes ?? []).filter((x) => x.firm_id === f.id && x.account === account).reduce((sum, x) => sum + Number(x.amount_paise), 0);
    const [kept, paid, cut, back] = [total('vendor_bill'), tax('tds_paid'), total('client_bill'), -tax('tds_claimed')];
    return { ...f, kept, paid, left: kept - paid, cut, back, claim: cut - back };
  });

  return (
    <>
      <h1>{t('tds.title')}</h1>
      <p className="lede">{t('tds.lede')}</p>
      {asked.taxError && <p className="banner bad" role="alert">{asked.taxError}</p>}
      <div className="card table-wrap flush">
        <table className="ledger">
          <thead><tr><th>{t('fields.firm_id')}</th><th className="num">{t('tax.tdsKept')}</th><th className="num">{t('tax.paid')}</th><th className="num">{t('tax.tdsLeft')}</th><th className="num">{t('tax.tdsCut')}</th><th className="num">{t('tax.tdsBack')}</th><th className="num">{t('tax.tdsClaim')}</th></tr></thead>
          <tbody>{firms.map((f) => (
            <tr key={f.id}><td>{f.name}</td><MoneyCell paise={f.kept} /><MoneyCell paise={f.paid} /><MoneyCell paise={f.left} strong tone="minus" /><MoneyCell paise={f.cut} /><MoneyCell paise={f.back} /><MoneyCell paise={f.claim} strong tone="plus" /></tr>
          ))}</tbody>
        </table>
      </div>
      <TaxPaid reason="tds_paid" month={lastMonth(today.slice(0, 7))} left={firms[0]!.left} accounts={accounts} today={today} back="/tds" />
      {rows.length === 0 ? (
        <p className="empty">{t('tds.none')}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('tds.date')}</th>
                <th>{t('tds.bill')}</th>
                <th>{t('tds.party')}</th>
                <th>{t('tds.direction')}</th>
                <th>{t('tds.section')}</th>
                <th className="num">{t('tds.rate')}</th>
                <th className="num">{t('tds.base')}</th>
                <th className="num">{t('tds.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.entry_id}${r.firm_id}`}>
                  <td className="whitespace-nowrap">{showDate(r.entry_date)}</td>
                  <td>
                    <Link href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</Link>{' '}
                    <span className="muted">{r.reference}</span>
                  </td>
                  <td>{(r.counter_firm_id ? names.firms.get(r.counter_firm_id) : names.parties.get(r.party_id ?? '')) ?? '?'}</td>
                  <td>{t(r.entry_type === 'vendor_bill' ? 'tds.deducted' : 'tds.clientDeducted')}</td>
                  <td>{r.section}</td>
                  <td className="num">{Number(r.rate_bp) / 100}%</td>
                  <td className="num">{showPaise(Number(r.base_paise))}</td>
                  <td className="num">{showPaise(Number(r.tds_paise))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
