import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LabourForm, OtherCostForm, type Person } from '@/components/labour-form';
import { MaterialUseForm } from '@/components/material-use-form';
import { SearchSelect } from '@/components/search-select';
import { WorkDoneForm } from '@/components/work-done-form';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { QTY, stockLines, valueOf, type Bought, type Used } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import type { Measure } from '@/lib/work';
import { Stat } from '../party/shared';
import { showDate, todayInIndia } from '../entries/data';
import { addLabour, addMaterialUse, addOtherCost, addWorkDone, removeReportLine } from './actions';
import { Icon } from '@/components/icons';
import { AutoForm } from '@/components/auto-form';

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

interface LabourRow {
  id: string;
  party_id: string;
  present: boolean;
  ot_hours: number | string;
  day_pay_paise: number | string;
  amount_paise: number | string;
  created_by: string;
}

interface OtherRow {
  id: string;
  description: string;
  cost_head: string;
  quantity: number | string;
  rate_paise: number | string;
  amount_paise: number | string;
  created_by: string;
}

type PersonRow = Person & { site_id: string | null; rate_paise: number | null };

const ERRORS = new Set(['not_removed']);
const sum = (rows: { amount_paise: number | string }[]) => rows.reduce((total, r) => total + Number(r.amount_paise), 0);

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

  const [{ data: used }, { data: bought }, { data: work }, { data: workers }, { data: labour }, { data: other }] = await Promise.all([
    db.from('material_use').select('id, site_id, material_id, use_date, quantity, remark, created_by')
      .eq('site_id', site.id).lte('use_date', date).order('created_at').returns<UseRow[]>(),
    db.rpc('app_site_bought', { p_site_id: site.id, p_upto: date }),
    db.from('work_done').select('id, activity, measurement, quantity, unit_id, rate_paise, amount_paise, created_by')
      .eq('site_id', site.id).eq('work_date', date).order('created_at').returns<WorkRow[]>(),
    // Staff first, then workers, by name: the order of the site sheet.
    db.from('parties').select('id, name, kind, rate_paise, site_id').in('kind', ['staff', 'worker']).eq('is_active', true)
      .order('kind', { ascending: false }).order('name').returns<PersonRow[]>(),
    db.from('labour_day').select('id, party_id, present, ot_hours, day_pay_paise, amount_paise, created_by')
      .eq('site_id', site.id).eq('work_date', date).returns<LabourRow[]>(),
    db.from('other_cost').select('id, description, cost_head, quantity, rate_paise, amount_paise, created_by')
      .eq('site_id', site.id).eq('work_date', date).order('created_at').returns<OtherRow[]>(),
  ]);
  const boughtRows: Bought[] = ((bought ?? []) as Omit<Bought, 'site_id' | 'entry_date'>[])
    .map((b) => ({ ...b, site_id: site.id, entry_date: date }));
  const stock = new Map(stockLines(boughtRows, used ?? [], date).map((s) => [s.material_id, s]));
  const usedToday = (used ?? []).filter((r) => r.use_date === date);
  const amount = (r: UseRow) => valueOf(Number(r.quantity), stock.get(r.material_id)?.rate ?? null);
  const materialTotal = usedToday.reduce((sum, r) => sum + amount(r), 0);
  const workRows = work ?? [];
  const workTotal = sum(workRows);

  // Everyone on the list is offered at their usual site, or at every site when they have none.
  const person = new Map((workers ?? []).map((p) => [p.id, p]));
  const labourRows = (labour ?? []).sort((a, b) => {
    const pa = person.get(a.party_id), pb = person.get(b.party_id);
    return (pa?.kind ?? '').localeCompare(pb?.kind ?? '') || (pa?.name ?? '').localeCompare(pb?.name ?? ''); // staff first
  });
  const marked = new Set(labourRows.map((r) => r.party_id));
  const unmarked: Person[] = (workers ?? []).filter((p) => !marked.has(p.id) && (!p.site_id || p.site_id === site.id))
    .map((p) => ({ id: p.id, name: p.name, kind: p.kind, rate: p.rate_paise === null ? null : Number(p.rate_paise) }));
  const isStaff = (r: LabourRow) => person.get(r.party_id)?.kind === 'staff';
  const presentCount = labourRows.filter((r) => r.present).length;
  const staffTotal = sum(labourRows.filter(isStaff));
  const labourTotal = sum(labourRows) - staffTotal;
  const otherRows = other ?? [];
  const otherTotal = sum(otherRows);
  const costTotal = materialTotal + labourTotal + staffTotal + otherTotal;
  const profit = workTotal - costTotal;

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
  const remove = (table: 'material_use' | 'work_done' | 'labour_day' | 'other_cost', id: string) => (
    <form action={removeReportLine.bind(null, table, id, site.id, date)}>
      <button type="submit" className="btn ghost small icon-btn" aria-label={t('report.remove')}><Icon name="close" size={16} /></button>
    </form>
  );
  const dayLink = (days: number) => `/report?site=${site.id}&date=${shiftDate(date, days)}`;

  return (
    <>
      <h1>{t('report.title')}</h1>
      <p className="lede">{t('report.lede')}</p>

      {/* Picking a site or a day opens it straight away; the keys reset the boxes when a day arrow is used. */}
      <AutoForm action="/report" className="card report-bar">
        <label className="activity-field grow">
          <span>{t('report.site')}</span>
          <SearchSelect key={site.id} name="site" defaultValue={site.id} required submitOnPick options={sites.map((s) => ({ value: s.id, label: s.name }))} />
        </label>
        <div className="activity-field">
          <span>{t('report.date')}</span>
          <div className="day-picker">
            <Link href={dayLink(-1)} className="btn ghost icon-btn" aria-label={t('report.prevDay')}><Icon name="chevronLeft" /></Link>
            <input key={date} type="date" name="date" defaultValue={date} max={today} required aria-label={t('report.date')} />
            {date < today && <Link href={dayLink(1)} className="btn ghost icon-btn" aria-label={t('report.nextDay')}><Icon name="chevronRight" /></Link>}
          </div>
        </div>
      </AutoForm>

      <div className="report-stats">
        <Stat label={t('report.workTotal')} value={showPaise(workTotal)} note={t('report.lines', { n: workRows.length })} tone="done" />
        <Stat label={t('report.costTotal')} value={showPaise(costTotal)} note={t('report.costNote')} />
        <Stat label={t('report.profit')} value={showPaise(profit)} note={t('report.profitNote')} tone={profit < 0 ? 'owe' : 'done'} />
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

      <section className="report-section" aria-labelledby="labour-title">
        <header className="report-head">
          <span className="sr-badge" aria-hidden="true">3</span>
          <div>
            <h2 id="labour-title">{t('report.labourHeading')}</h2>
            <p className="muted">{t('report.labourNote', { p: presentCount, a: labourRows.length - presentCount })}</p>
          </div>
          <span className="section-total">{showPaise(labourTotal + staffTotal)}</span>
        </header>

        {labourRows.length === 0 ? (
          <p className="card empty-state">{t('report.noLabour')}</p>
        ) : (
          <div className="card table-wrap flush">
            <table className="ledger">
              <thead>
                <tr>
                  <th className="num">{t('report.no')}</th>
                  <th>{t('report.labour.name')}</th>
                  <th>{t('report.labour.attendance')}</th>
                  <th className="num">{t('report.labour.ot')}</th>
                  <th className="num">{t('report.labour.dayPay')}</th>
                  <th className="num">{t('report.amount')}</th>
                  <th aria-label={t('report.remove')} />
                </tr>
              </thead>
              <tbody>
                {labourRows.map((r, i) => {
                  const p = person.get(r.party_id);
                  const kind = p?.kind ?? 'worker';
                  return (
                    <tr key={r.id}>
                      <td className="num muted">{i + 1}</td>
                      <td>
                        <strong>{p?.name}</strong>
                        {kind === 'staff' && <span className="pill common small-pill">{t('report.labour.staff')}</span>}
                      </td>
                      <td><span className={`pill ${r.present ? 'verified' : 'pending'}`}>{t(`report.labour.mark.${r.present ? 'P' : 'A'}`)}</span></td>
                      <td className="num">{Number(r.ot_hours) > 0 ? t('report.labour.otHours', { n: Number(r.ot_hours) }) : '–'}</td>
                      <td className="num">{r.present ? showPaise(Number(r.day_pay_paise)) : '–'}</td>
                      <td className="num">{showPaise(Number(r.amount_paise))}</td>
                      <td>{canRemove(r.created_by) && remove('labour_day', r.id)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td /><td colSpan={4}>{t('report.labourTotal')}</td><td className="num">{showPaise(labourTotal)}</td><td /></tr>
                <tr><td /><td colSpan={4}>{t('report.staffTotal')}</td><td className="num">{showPaise(staffTotal)}</td><td /></tr>
              </tfoot>
            </table>
          </div>
        )}

        {unmarked.length > 0 ? (
          <LabourForm key={[...marked].join()} people={unmarked} action={addLabour.bind(null, site.id, date)} />
        ) : (
          <p className="card empty-state">
            {t(labourRows.length ? 'report.allMarked' : 'report.noWorkers')}{' '}
            {office && <Link href="/masters/workers">{t('report.workerList')}</Link>}
          </p>
        )}
      </section>

      <section className="report-section" aria-labelledby="other-title">
        <header className="report-head">
          <span className="sr-badge" aria-hidden="true">4</span>
          <div>
            <h2 id="other-title">{t('report.otherHeading')}</h2>
            <p className="muted">{t('report.otherNote')}</p>
          </div>
          <span className="section-total">{showPaise(otherTotal)}</span>
        </header>

        {otherRows.length > 0 && (
          <div className="card table-wrap flush">
            <table className="ledger">
              <thead>
                <tr>
                  <th>{t('report.other.description')}</th>
                  <th>{t('report.other.head')}</th>
                  <th className="num">{t('report.other.quantity')}</th>
                  <th className="num">{t('report.rate')}</th>
                  <th className="num">{t('report.amount')}</th>
                  <th aria-label={t('report.remove')} />
                </tr>
              </thead>
              <tbody>
                {otherRows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.description}</strong></td>
                    <td>{t(`options.cost_head.${r.cost_head}`)}</td>
                    <td className="num">{QTY.format(Number(r.quantity))}</td>
                    <td className="num">{showPaise(Number(r.rate_paise))}</td>
                    <td className="num">{showPaise(Number(r.amount_paise))}</td>
                    <td>{canRemove(r.created_by) && remove('other_cost', r.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <OtherCostForm action={addOtherCost.bind(null, site.id, date)} />
      </section>

      <section className="report-section" aria-labelledby="profit-title">
        <header className="report-head">
          <span className="sr-badge" aria-hidden="true">5</span>
          <div>
            <h2 id="profit-title">{t('report.profitHeading')}</h2>
            <p className="muted">{site.name} · {showDate(date)}</p>
          </div>
        </header>
        <div className="card table-wrap flush">
          <table className="ledger">
            <tbody>
              <tr><td><strong>{t('report.workTotal')}</strong></td><td className="num"><strong>{showPaise(workTotal)}</strong></td></tr>
              <tr><td>{t('report.less', { what: t('report.materialHeading') })}</td><td className="num">{showPaise(materialTotal)}</td></tr>
              <tr><td>{t('report.less', { what: t('report.labourTotal') })}</td><td className="num">{showPaise(labourTotal)}</td></tr>
              <tr><td>{t('report.less', { what: t('report.staffTotal') })}</td><td className="num">{showPaise(staffTotal)}</td></tr>
              <tr><td>{t('report.less', { what: t('report.otherHeading') })}</td><td className="num">{showPaise(otherTotal)}</td></tr>
            </tbody>
            <tfoot>
              <tr>
                <td>{t('report.profit')}</td>
                <td className={profit < 0 ? 'num minus' : 'num plus'}><strong>{showPaise(profit)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
}
