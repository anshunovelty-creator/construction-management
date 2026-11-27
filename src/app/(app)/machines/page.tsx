import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ListLink } from '@/components/list-link';
import { RowFilter } from '@/components/row-filter';
import { requireProfile } from '@/lib/auth';
import { isService, lastService, latestPaper, nextServiceAt, PAPER_NAMES, PAPERS, paperState, showHours, totalCost } from '@/lib/machines';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../entries/data';
import { MoneyCell, Stat } from '../party/shared';
import { loadMachines } from './data';
import { PaperPill } from './paper-pill';

/** The client's AJAX machines: who has each one on rent, when it was last serviced, when the next service falls due, and how long its papers last. */
export default async function MachinesPage() {
  await requireProfile('owner', 'office');
  const t = await getTranslations();
  const machines = await loadMachines(await createClient());
  const today = todayInIndia();
  const rows = machines.map((m) => ({
    ...m, last: lastService(m.services), cost: totalCost(m.services.filter(isService)),
    papers: PAPERS.map((paper) => latestPaper(m.services, paper)?.valid_until ?? undefined),
  }));
  // Only machines still in use are warned about, and only for papers they have had.
  const alerts = rows.filter((r) => r.is_active).flatMap((r) => r.papers).filter((until) => ['soon', 'out'].includes(paperState(until, today))).length;
  const allCost = rows.reduce((sum, r) => sum + r.cost, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('machines.title')}</h1>
          <p className="lede">{t('machines.lede')}</p>
        </div>
        <Link href="/machines/new" className="btn">{t('machines.add')}</Link>
      </div>

      <div className="stats">
        <Stat label={t('machines.count')} value={String(rows.filter((r) => r.is_active).length)} />
        <Stat label={t('machines.totalCost')} value={showPaise(allCost)} />
      </div>

      {alerts > 0 && <p className="banner bad" role="alert">{t('machines.papers.alert', { count: alerts })}</p>}

      {rows.length === 0 ? (
        <p className="card empty-state">{t('machines.none')}</p>
      ) : (
        <>
          <div className="toolbar">
            <RowFilter table="machines" label={t('machines.search')} placeholder={t('machines.searchHint')} none={t('machines.searchNone')} />
          </div>
          <div className="card table-wrap flush hide-when-empty">
            <table className="ledger clickable" id="machines">
              <thead>
                <tr>
                  <th>{t('machines.name')}</th>
                  <th>{t('machines.rentedTo')}</th>
                  <th>{t('machines.lastServiced')}</th>
                  <th className="num">{t('machines.atHours')}</th>
                  <th className="num">{t('machines.lastCost')}</th>
                  <th className="num">{t('machines.nextAt')}</th>
                  <th className="num">{t('machines.totalCost')}</th>
                  {PAPERS.map((paper) => <th key={paper}>{PAPER_NAMES[paper]}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-name={`${r.name} ${r.rented_to}`}>
                    <td><ListLink href={`/machines/${r.id}`} className="party-link">{r.name}</ListLink>{!r.is_active && <span className="muted"> · {t('machines.notInUse')}</span>}</td>
                    <td>{r.rented_to || <span className="muted">–</span>}</td>
                    <td>{r.last ? showDate(r.last.service_date) : <span className="muted">{t('machines.notYet')}</span>}</td>
                    <td className="num">{r.last ? showHours(r.last.running_hours) : '–'}</td>
                    <MoneyCell paise={r.last ? Number(r.last.cost_paise) : 0} />
                    <td className="num strong">{r.last ? showHours(nextServiceAt(r.last.running_hours, r.service_every_hours)) : '–'}</td>
                    <MoneyCell paise={r.cost} />
                    {r.papers.map((until, i) => <td key={PAPERS[i]}><PaperPill until={until} today={today} t={t} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
