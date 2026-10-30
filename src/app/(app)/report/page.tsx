import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { MaterialUseForm } from '@/components/material-use-form';
import { WorkDoneForm } from '@/components/work-done-form';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { QTY, stockLines, valueOf, type Bought, type Used } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import type { Measure } from '@/lib/work';
import { Stat } from '../party/shared';
import { showDate, todayInIndia } from '../entries/data';
import { addMaterialUse, addWorkDone, removeReportLine } from './actions';
import { Icon } from '@/components/icons';

interface UseRow extends Used {
  id: string;
  remark: string;
  created_by: string;
}

interface WorkRow {
  id: string;
  activity: string;
  measurement: string;
  quantity: number | string;
  unit_id: string;
  rate_paise: number | string;
  amount_paise: number | string;
  created_by: string;
}

const ERRORS = new Set(['not_removed']);

/** "2026-10-18" moved by `days`. */
const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * A site's daily report, like the Excel sheet: 1. the work done that day (measurements × rates), 2. the material used,
 * which comes out of the site's stock at the average rate it was bought at. Supervisors fill it for their own sites.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ site?: string; date?: string; error?: string }> }) {
  const profile = await requireProfile('owner', 'office', 'supervisor');
  const office = profile.role !== 'supervisor';
  const t = await getTranslations();
  const db = await createClient();
  const params = await searchParams;
  const today = todayInIndia();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : today;

  // Supervisors see only the sites given to them in People.
  const [{ data: allSites }, { data: mySites }, { data: materials }, { data: units }] = await Promise.all([
    db.from('sites').select('id, name').eq('is_active', true).order('name'),
    office ? Promise.resolve({ data: null }) : db.from('user_sites').select('site_id').eq('user_id', profile.user_id),
    db.from('materials').select('id, name, is_active, unit:units(name)')
      .order('name').returns<{ id: string; name: string; is_active: boolean; unit: { name: string } | null }[]>(),
    db.from('units').select('id, name, measure, is_active').order('name'),
  ]);
  const mine = mySites && new Set(mySites.map((s) => s.site_id as string));
  const sites = (allSites ?? []).filter((s) => !mine || mine.has(s.id));
  if (sites.length === 0) return <p className="empty">{t('report.noSites')}</p>;
  const site = sites.find((s) => s.id === params.site) ?? sites[0]!;
  const material = new Map((materials ?? []).map((m) => [m.id, m]));
  const unitOf = (id: string) => material.get(id)?.unit?.name ?? '';
  const unitName = new Map((units ?? []).map((u) => [u.id as string, u.name as string]));

  const [{ data: used }, { data: bought }, { data: work }] = await Promise.all([
    db.from('material_use').select('id, site_id, material_id, use_date, quantity, remark, created_by')
      .eq('site_id', site.id).lte('use_date', date).order('created_at').returns<UseRow[]>(),
    db.rpc('app_site_bought', { p_site_id: site.id, p_upto: date }),
    db.from('work_done').select('id, activity, measurement, quantity, unit_id, rate_paise, amount_paise, created_by')
      .eq('site_id', site.id).eq('work_date', date).order('created_at').returns<WorkRow[]>(),
  ]);
  const boughtRows: Bought[] = ((bought ?? []) as Omit<Bought, 'site_id' | 'entry_date'>[])
    .map((b) => ({ ...b, site_id: site.id, entry_date: date }));
  const stock = new Map(stockLines(boughtRows, used ?? [], date).map((s) => [s.material_id, s]));
  const usedToday = (used ?? []).filter((r) => r.use_date === date);
  const amount = (r: UseRow) => valueOf(Number(r.quantity), stock.get(r.material_id)?.rate ?? null);
  const materialTotal = usedToday.reduce((sum, r) => sum + amount(r), 0);
  const workRows = work ?? [];
  const workTotal = workRows.reduce((sum, r) => sum + Number(r.amount_paise), 0);

  // Lines of the same activity typed one after another form one numbered activity, like the sheet.
  const activities: { no: number; name: string; rows: WorkRow[]; total: number }[] = [];
  for (const r of workRows) {
    const last = activities.at(-1);
    if (last && last.name === r.activity) last.rows.push(r);
    else activities.push({ no: activities.length + 1, name: r.activity, rows: [r], total: 0 });
    activities.at(-1)!.total += Number(r.amount_paise);
  }

  const error = params.error && (ERRORS.has(params.error) ? t(`report.errors.${params.error}`) : params.error);
  const unitChoices = (units ?? []).filter((u) => u.is_active)
    .map((u) => ({ id: u.id as string, name: u.name as string, measure: u.measure as Measure }));
  const materialChoices = (materials ?? []).filter((m) => m.is_active).map((m) => {
    const s = stock.get(m.id);
    return { id: m.id, name: m.name, unit: m.unit?.name ?? '', rate: s?.rate ?? null, left: s?.left ?? 0 };
  });
  const canRemove = (createdBy: string) => office || createdBy === profile.user_id;
  const remove = (table: 'material_use' | 'work_done', id: string) => (
    <form action={removeReportLine.bind(null, table, id, site.id, date)}>
      <button type="submit" className="btn ghost small icon-btn" aria-label={t('report.remove')}><Icon name="close" size={16} /></button>
    </form>
  );
  const dayLink = (days: number) => `/report?site=${site.id}&date=${shiftDate(date, days)}`;

  return (
    <>
      <h1>{t('report.title')}</h1>
      <p className="lede">{t('report.lede')}</p>

      <form className="card report-bar" method="get">
        <label className="activity-field grow">
          <span>{t('report.site')}</span>
          <select name="site" defaultValue={site.id}>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="activity-field">
          <span>{t('report.date')}</span>
          <div className="day-picker">
            <Link href={dayLink(-1)} className="btn ghost icon-btn" aria-label={t('report.prevDay')}><Icon name="chevronLeft" /></Link>
            <input type="date" name="date" defaultValue={date} max={today} aria-label={t('report.date')} />
            {date < today && <Link href={dayLink(1)} className="btn ghost icon-btn" aria-label={t('report.nextDay')}><Icon name="chevronRight" /></Link>}
          </div>
        </div>
        <button type="submit" className="btn">{t('report.open')}</button>
      </form>

      <div className="report-stats">
        <Stat label={t('report.workTotal')} value={showPaise(workTotal)} note={t('report.lines', { n: workRows.length })} tone="done" />
        <Stat label={t('report.total')} value={showPaise(materialTotal)} note={t('report.lines', { n: usedToday.length })} />
        <Stat
          label={t('report.workLessMaterial')}
          value={showPaise(workTotal - materialTotal)}
          note={t('report.labourNext')}
          tone={workTotal - materialTotal < 0 ? 'owe' : undefined}
        />
      </div>

      {error && <p className="banner bad">{error}</p>}

      <section className="report-section" aria-labelledby="work-title">
        <header className="report-head">
          <span className="sr-badge" aria-hidden="true">1</span>
          <div>
            <h2 id="work-title">{t('report.workHeading')}</h2>
            <p className="muted">{site.name} · {showDate(date)}</p>
          </div>
          <span className="section-total">{showPaise(workTotal)}</span>
        </header>

        {activities.length === 0 ? (
          <p className="card empty-state">{t('report.noWork')}</p>
        ) : (
          <div className="card table-wrap flush">
            <table className="ledger saved-work">
              <thead>
                <tr>
                  <th className="num">{t('report.no')}</th>
                  <th>{t('report.activity')}</th>
                  <th>{t('report.measurement')}</th>
                  <th className="num">{t('report.quantity')}</th>
                  <th className="num">{t('report.rate')}</th>
                  <th className="num">{t('report.amount')}</th>
                  <th aria-label={t('report.remove')} />
                </tr>
              </thead>
              {activities.map((a) => (
                <tbody key={a.no}>
                  {a.rows.map((r, i) => (
                    <tr key={r.id}>
                      <td className="num muted">{i === 0 && a.no}</td>
                      <td>{i === 0 && <strong>{a.name}</strong>}</td>
                      <td>{r.measurement}</td>
                      <td className="num">{QTY.format(Number(r.quantity))} {unitName.get(r.unit_id)}</td>
                      <td className="num">{showPaise(Number(r.rate_paise))}</td>
                      <td className="num">{showPaise(Number(r.amount_paise))}</td>
                      <td>{canRemove(r.created_by) && remove('work_done', r.id)}</td>
                    </tr>
                  ))}
                  {a.rows.length > 1 && (
                    <tr className="subtotal">
                      <td /><td colSpan={4}>{t('report.activityTotal', { name: a.name })}</td>
                      <td className="num">{showPaise(a.total)}</td><td />
                    </tr>
                  )}
                </tbody>
              ))}
              <tfoot>
                <tr>
                  <td /><td colSpan={4}>{t('report.workTotal')}</td>
                  <td className="num"><strong>{showPaise(workTotal)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <WorkDoneForm units={unitChoices} action={addWorkDone.bind(null, site.id, date)} />
      </section>

      <section className="report-section" aria-labelledby="material-title">
        <header className="report-head">
          <span className="sr-badge" aria-hidden="true">2</span>
          <div>
            <h2 id="material-title">{t('report.materialHeading')}</h2>
            <p className="muted">{t('report.materialNote')}</p>
          </div>
          <span className="section-total">{showPaise(materialTotal)}</span>
        </header>

        {usedToday.length === 0 ? (
          <p className="card empty-state">{t('report.noneUsed')}</p>
        ) : (
          <div className="card table-wrap flush">
            <table className="ledger">
              <thead>
                <tr>
                  <th>{t('report.material')}</th>
                  <th className="num">{t('report.used')}</th>
                  <th className="num">{t('report.rate')}</th>
                  <th className="num">{t('report.amount')}</th>
                  <th className="num">{t('report.left')}</th>
                  <th>{t('report.remark')}</th>
                  <th aria-label={t('report.remove')} />
                </tr>
              </thead>
              <tbody>
                {usedToday.map((r) => {
                  const s = stock.get(r.material_id);
                  return (
                    <tr key={r.id}>
                      <td><strong>{material.get(r.material_id)?.name}</strong></td>
                      <td className="num">{QTY.format(Number(r.quantity))} {unitOf(r.material_id)}</td>
                      <td className="num">{s?.rate == null ? '—' : showPaise(Math.round(s.rate))}</td>
                      <td className="num">{showPaise(amount(r))}</td>
                      <td className={s && s.left < 0 ? 'num minus' : 'num'} title={s && s.left < 0 ? t('stock.belowZero') : undefined}>
                        {s ? `${QTY.format(s.left)} ${unitOf(r.material_id)}` : ''}
                      </td>
                      <td>{r.remark}</td>
                      <td>{canRemove(r.created_by) && remove('material_use', r.id)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>{t('report.total')}</td>
                  <td className="num"><strong>{showPaise(materialTotal)}</strong></td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <MaterialUseForm materials={materialChoices} action={addMaterialUse.bind(null, site.id, date)} />
      </section>
    </>
  );
}
