import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate } from '../entries/data';

interface TdsRow {
  entry_id: string;
  serial: string;
  entry_type: 'vendor_bill' | 'client_bill';
  entry_date: string;
  reference: string;
  party_id: string;
  section: string;
  rate_bp: number;
  base_paise: number | string;
  tds_paise: number | string;
}

/**
 * The TDS record for the working firm: every bill with TDS, with its rate, section and the amount.
 * TDS we deducted from vendors is owed to the government; TDS clients deducted from our bills can be claimed back.
 */
export default async function TdsPage() {
  await requireProfile('owner', 'office');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const db = await createClient();
  const [{ data }, names] = await Promise.all([
    db.from('tds_rows').select('*').eq('firm_id', working.firm.id).order('entry_date').order('serial').returns<TdsRow[]>(),
    loadNames(db),
  ]);
  const rows = data ?? [];
  const total = (type: TdsRow['entry_type']) =>
    rows.filter((r) => r.entry_type === type).reduce((sum, r) => sum + Number(r.tds_paise), 0);

  return (
    <>
      <h1>{t('tds.title')}</h1>
      <p className="lede">{t('tds.lede')}</p>
      <dl className="bill-totals">
        <div><dt>{t('tds.toGovernment')}</dt><dd>{showPaise(total('vendor_bill'))}</dd></div>
        <div><dt>{t('tds.toClaim')}</dt><dd>{showPaise(total('client_bill'))}</dd></div>
      </dl>
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
                <tr key={r.entry_id}>
                  <td className="whitespace-nowrap">{showDate(r.entry_date)}</td>
                  <td>
                    <Link href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</Link>{' '}
                    <span className="muted">{r.reference}</span>
                  </td>
                  <td>{names.parties.get(r.party_id) ?? '?'}</td>
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
