import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ListLink } from '@/components/list-link';
import { RowFilter } from '@/components/row-filter';
import { requireProfile } from '@/lib/auth';
import { lastService, nextServiceAt, showHours, totalCost } from '@/lib/machines';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate } from '../entries/data';
import { MoneyCell, Stat } from '../party/shared';
import { loadMachines } from './data';

/** The client's AJAX machines: who has each one on rent, when it was last serviced, and when the next service falls due. */
export default async function MachinesPage() {
  await requireProfile('owner', 'office');
  const t = await getTranslations();
  const machines = await loadMachines(await createClient());
  const rows = machines.map((m) => ({ ...m, last: lastService(m.services), cost: totalCost(m.services) }));
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
