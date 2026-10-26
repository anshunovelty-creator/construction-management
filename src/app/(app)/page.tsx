import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RowFilter } from '@/components/row-filter';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { sumFigures } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate } from './entries/data';
import { loadFirmParties, MoneyCell, Stat, StatusPill } from './party/shared';

/** Home: every party the working firm owes, one line each, like the Index sheet of the outstanding workbook. */
export default async function PartyIndexPage() {
  const profile = await requireProfile();
  if (profile.role === 'supervisor') redirect('/overview');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const [parties, { data: vendors }] = await Promise.all([
    loadFirmParties(db, firm.id),
    db.from('parties').select('id, name').eq('kind', 'vendor').eq('is_active', true).order('name'),
  ]);
  const sum = sumFigures(parties.map((p) => p.f));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('party.indexTitle', { firm: firm.name })}</h1>
          <p className="lede">{t('party.indexLede')}</p>
        </div>
        <Link href="/dashboard" className="btn ghost">{t('nav.dashboard')} ►</Link>
      </div>

      {parties.length === 0 ? (
        <p className="card empty">{t('party.empty')}</p>
      ) : (
        <>
          <div className="stats">
            <Stat label={t('party.total')} value={showPaise(sum.total)} note={t('party.partyCount', { count: parties.length })} />
            <Stat label={t('party.paid')} value={showPaise(sum.paid)} note={t('party.percentNote', { percent: sum.percentPaid })} tone="done" />
            <Stat label={t('dashboard.balance')} value={showPaise(sum.balance)} note={t('party.balanceNote')} tone="owe" />
          </div>

          <div className="toolbar">
            <RowFilter table="parties" label={t('party.search')} placeholder={t('party.searchHint')} none={t('party.searchNone')} />
            <p className="hint">{t('party.clickHint')}</p>
          </div>
          <div className="card table-wrap flush">
            <table className="ledger clickable" id="parties">
              <thead>
                <tr>
                  <th className="num">{t('party.sr')}</th>
                  <th>{t('party.name')}</th>
                  <th className="num">{t('party.opening')}</th>
                  <th className="num">{t('party.bills')}</th>
                  <th className="num">{t('party.total')}</th>
                  <th className="num">{t('party.paid')}</th>
                  <th className="num">{t('party.balance')}</th>
                  <th className="num">{t('party.percentPaid')}</th>
                  <th>{t('party.status')}</th>
                  <th>{t('party.lastPayment')}</th>
                </tr>
              </thead>
              <tbody>
                {parties.map(({ id, name, f }, i) => (
                  <tr key={id} data-name={name}>
                    <td className="num muted">{i + 1}</td>
                    {/* The name's link stretches over the whole row, so a click anywhere opens the party. */}
                    <td><Link href={`/party?id=${id}`} className="party-link">{name}</Link></td>
                    <MoneyCell paise={f.opening} />
                    <MoneyCell paise={f.bills} />
                    <MoneyCell paise={f.total} />
                    <MoneyCell paise={f.paid} />
                    <MoneyCell paise={f.balance} strong />
                    <td className="num">{f.percentPaid}%</td>
                    <td><StatusPill status={f.status} t={t} /></td>
                    <td className="nowrap">{f.lastPayment ? showDate(f.lastPayment) : <span className="muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td>{t('party.grandTotal')}</td>
                  <MoneyCell paise={sum.opening} />
                  <MoneyCell paise={sum.bills} />
                  <MoneyCell paise={sum.total} />
                  <MoneyCell paise={sum.paid} />
                  <MoneyCell paise={sum.balance} strong />
                  <td className="num">{sum.percentPaid}%</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <form action="/party" className="open-other card">
        <label htmlFor="open-id">{t('party.openOther')}</label>
        <select id="open-id" name="id" required defaultValue="">
          <option value="" disabled>{t('common.choose')}</option>
          {(vendors ?? []).map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
        <button type="submit" className="btn ghost">{t('party.open')} ►</button>
        <p className="hint">
          {t('party.openOtherHint')} <Link href="/masters/parties" className="underline">{t('party.addParty')}</Link>
        </p>
      </form>
    </>
  );
}
