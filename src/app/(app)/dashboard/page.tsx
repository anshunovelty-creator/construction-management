import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { sumFigures } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { FirmTabs, loadFirmParties, MoneyCell, Stat } from '../party/shared';

/** The workbook's Dashboard sheet: big totals, counts by status, the top 5 and a bar per party. */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  await requireProfile('owner', 'office');
  const { firm: want } = await searchParams;
  const [{ firms, firm, parties }, t] = await Promise.all([loadFirmParties(await createClient(), want), getTranslations()]);
  if (!firm) return <p className="empty">{t('party.noFirm')}</p>;
  const sum = sumFigures(parties.map((p) => p.f));
  const count = (status: string) => parties.filter((p) => p.f.status === status).length;
  const top = [...parties].sort((a, b) => b.f.balance - a.f.balance).slice(0, 5);
  const widest = Math.max(1, ...parties.map((p) => p.f.total));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('dashboard.title', { firm: firm.name })}</h1>
          <p className="lede">{t('dashboard.lede')}</p>
        </div>
        <Link href={`/?firm=${firm.id}`} className="btn ghost">◄ {t('party.home')}</Link>
      </div>
      <FirmTabs firms={firms} firm={firm} path="/dashboard" t={t} />

      <div className="stats big">
        <Stat label={t('party.total')} value={showPaise(sum.total)} />
        <Stat label={t('party.paid')} value={showPaise(sum.paid)} tone="done" />
        <Stat label={t('dashboard.balance')} value={showPaise(sum.balance)} tone="owe" note={t('party.balanceNote')} />
        <Stat label={t('party.percentPaid')} value={`${sum.percentPaid}%`} />
      </div>
      <div className="stats">
        <Stat label={t('party.opening')} value={showPaise(sum.opening)} />
        <Stat label={t('dashboard.newBills')} value={showPaise(sum.bills)} />
        <Stat label={t('dashboard.parties')} value={String(parties.length)} />
        <Stat label={t('party.statuses.cleared')} value={String(count('cleared'))} />
        <Stat label={t('party.statuses.partPaid')} value={String(count('partPaid'))} />
        <Stat label={t('party.statuses.pending')} value={String(count('pending'))} />
      </div>

      {top.length > 0 && (
        <section className="card">
          <h2>{t('dashboard.top5')}</h2>
          <div className="table-wrap"><table className="ledger clickable">
            <thead>
              <tr>
                <th className="num">{t('dashboard.rank')}</th>
                <th>{t('party.name')}</th>
                <th className="num">{t('party.total')}</th>
                <th className="num">{t('party.paid')}</th>
                <th className="num">{t('party.balance')}</th>
                <th className="num">{t('party.percentPaid')}</th>
              </tr>
            </thead>
            <tbody>
              {top.map(({ id, name, f }, i) => (
                <tr key={id}>
                  <td className="num muted">{i + 1}</td>
                  <td><Link href={`/party?firm=${firm.id}&id=${id}`} className="party-link">{name}</Link></td>
                  <MoneyCell paise={f.total} />
                  <MoneyCell paise={f.paid} />
                  <MoneyCell paise={f.balance} strong />
                  <td className="num">{f.percentPaid}%</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      {parties.length > 0 && (
        <section className="card">
          <h2>{t('dashboard.chart')}</h2>
          <p className="hint">{t('dashboard.chartHint')}</p>
          <ul className="bars">
            {parties.map(({ id, name, f }) => (
              <li key={id}>
                <span className="bar-name">{name}</span>
                <span className="bar-track">
                  <span className="bar" style={{ width: `${(Math.max(f.total, 0) / widest) * 100}%` }}>
                    <span className="bar-paid" style={{ width: `${Math.min(f.percentPaid, 100)}%` }} />
                  </span>
                </span>
                <span className="bar-val num">{showPaise(f.paid)} / {showPaise(f.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
