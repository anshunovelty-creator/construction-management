import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AccountOptions } from '@/components/account-options';
import { LabourForm, OtherCostForm, type Person } from '@/components/labour-form';
import { MaterialUseForm } from '@/components/material-use-form';
import { SearchSelect } from '@/components/search-select';
import { WorkDoneForm } from '@/components/work-done-form';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { byWork, QTY, stockLines, valueOf, type Bought, type Used } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import { lineSerial, type Measure } from '@/lib/work';
import { dayPay } from '@/lib/wages';
import { payAccounts } from '../pay/data';
import { Stat } from '../party/shared';
import { showDate, todayInIndia } from '../entries/data';
import { addLabour, addMaterialUse, addOtherCost, addWorkDone, payCost, removeReportLine } from './actions';
import { Icon } from '@/components/icons';
import { AutoForm } from '@/components/auto-form';
import { PrintButton } from '@/components/print-button';
import { Help } from '@/components/help';
import { ReportParts } from '@/components/report-parts';
import { PrintSheet, type SheetData } from './print-sheet';

interface UseRow extends Used {
  rate_paise: number | string | null;
  id: string;
  remark: string;
  mix_name: string;
  created_by: string;
}

interface WorkRow {
  id: string;
  activity: string;
  location: string | null;
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
  entry_id: string | null;
  on_bill: boolean | null;
}

type PersonRow = Pick<Person, 'id' | 'name' | 'kind'> & { site_id: string | null; rate_paise: number | null };

const ERRORS = new Set(['not_removed']);
const sum = (rows: { amount_paise: number | string }[]) => rows.reduce((total, r) => total + Number(r.amount_paise), 0);

/** "2026-10-18" moved by `days`. */
const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * A site's daily report, like the Excel sheet: 1. the work done that day (measurements × rates), 2. the material used,
 * which comes out of the site's stock at the average rate it arrived at. Supervisors fill it for their own sites.
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
    db.from('materials').select('id, name, is_active, item_kind, unit:units(name)')
      .order('name').returns<{ id: string; name: string; is_active: boolean; item_kind: string; unit: { name: string } | null }[]>(),
    db.from('units').select('id, name, measure, is_active').order('name'),
  ]);
  const mine = mySites && new Set(mySites.map((s) => s.site_id as string));
  const sites = (allSites ?? []).filter((s) => !mine || mine.has(s.id));
  if (sites.length === 0) return <p className="empty">{t('report.noSites')}</p>;
  const site = sites.find((s) => s.id === params.site) ?? sites[0]!;
  const material = new Map((materials ?? []).map((m) => [m.id, m]));
  const unitOf = (id: string) => material.get(id)?.unit?.name ?? '';
  const unitName = new Map((units ?? []).map((u) => [u.id as string, u.name as string]));

  const [{ data: used }, { data: bought }, { data: work }, { data: listed }, { data: siteStaff }, { data: marks }, { data: recent }, { data: away }, { data: other }, { data: mixes }] = await Promise.all([
    db.from('material_use').select('id, site_id, material_id, use_date, quantity, rate_paise, remark, mix_name, created_by')
      .eq('site_id', site.id).lte('use_date', date).order('created_at').returns<UseRow[]>(),
    db.from('stock_in_rows').select('site_id, material_id, entry_date, quantity, amount_paise')
      .eq('site_id', site.id).lte('entry_date', date).returns<Bought[]>(),
    db.from('work_done').select('id, activity, location, measurement, quantity, unit_id, rate_paise, amount_paise, created_by')
      .eq('site_id', site.id).eq('work_date', date).order('created_at').returns<WorkRow[]>(),
    // Staff first, then workers, by name: the order of the site sheet.
    db.from('parties').select('id, name, kind, rate_paise, site_id').in('kind', ['staff', 'worker']).eq('is_active', true)
      .order('kind', { ascending: false }).order('name').returns<PersonRow[]>(),
    // A supervisor gets the staff by name only: what they are paid is for the owner and office.
    office ? Promise.resolve({ data: null }) : db.rpc('app_site_staff'),
    db.from('labour_day').select('id, party_id, present, ot_hours, day_pay_paise, amount_paise, created_by, staff:labour_day_staff(day_pay_paise, amount_paise)')
      .eq('site_id', site.id).eq('work_date', date).returns<(LabourRow & { staff: Pick<LabourRow, 'day_pay_paise' | 'amount_paise'> | null })[]>(),
    // Who works here: marked present at this site in the last two weeks. Anyone present at another site today is named.
    db.from('labour_day').select('party_id').eq('site_id', site.id).eq('present', true).gte('work_date', shiftDate(date, -14)).lte('work_date', date).returns<{ party_id: string }[]>(),
    db.rpc('app_present_elsewhere', { p_site: site.id, p_date: date }),
    db.from('other_cost').select('id, description, cost_head, quantity, rate_paise, amount_paise, created_by, entry_id, on_bill')
      .eq('site_id', site.id).eq('work_date', date).order('created_at').returns<OtherRow[]>(),
    db.from('mixes').select('id, name, unit:units(name), items:mix_items(material_id, quantity, position)').eq('is_active', true).order('name')
      .returns<{ id: string; name: string; unit: { name: string } | null; items: { material_id: string; quantity: number | string; position: number }[] }[]>(),
  ]);
  const stock = new Map(stockLines(bought ?? [], used ?? [], date).map((s) => [s.material_id, s]));
  const usedToday = (used ?? []).filter((r) => r.use_date === date);
  // The rate the supervisor gave the line, else the site's average.
  const rateOf = (r: UseRow) => (r.rate_paise !== null ? Number(r.rate_paise) : stock.get(r.material_id)?.rate ?? null);
  const amount = (r: UseRow) => valueOf(Number(r.quantity), rateOf(r));
  const materialTotal = usedToday.reduce((sum, r) => sum + amount(r), 0);
  const usedGroups = byWork(usedToday).map((g) => ({ ...g, total: g.rows.reduce((sum, r) => sum + amount(r), 0) }));
  const workRows = work ?? [];
  const workTotal = sum(workRows);

  const workers: PersonRow[] = [
    ...((siteStaff ?? []) as { id: string; name: string; site_id: string | null }[]).map((p) => ({ ...p, kind: 'staff' as const, rate_paise: null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    ...(listed ?? []),
  ];
  const labour = (marks ?? []).map(({ staff, ...r }) => ({ ...r, ...staff }));
  // Everyone on the list is offered at their usual site, or at every site when they have none.
  const person = new Map(workers.map((p) => [p.id, p]));
  const labourRows = labour.sort((a, b) => {
    const pa = person.get(a.party_id), pb = person.get(b.party_id);
    return (pa?.kind ?? '').localeCompare(pb?.kind ?? '') || (pa?.name ?? '').localeCompare(pb?.name ?? ''); // staff first
  });
  const marked = new Set(labourRows.map((r) => r.party_id));
  const here = new Set((recent ?? []).map((x) => x.party_id));
  const elsewhere = new Set(((away ?? []) as { party_id: string }[]).map((x) => x.party_id));
  const unmarked: Person[] = workers.filter((p) => !marked.has(p.id) && (!p.site_id || p.site_id === site.id))
    .map((p) => ({ id: p.id, name: p.name, kind: p.kind, hidden: !office && p.kind === 'staff', here: p.site_id === site.id || here.has(p.id), elsewhere: elsewhere.has(p.id), rate: p.rate_paise === null ? null : Number(p.rate_paise),
      dayPay: p.rate_paise === null ? null : dayPay(p.kind, Number(p.rate_paise), date) }));
  const isStaff = (r: LabourRow) => person.get(r.party_id)?.kind === 'staff';
  const presentCount = labourRows.filter((r) => r.present).length;
  const staffTotal = sum(labourRows.filter(isStaff));
  const labourTotal = sum(labourRows) - staffTotal;
  const otherRows = other ?? [];
  const otherTotal = sum(otherRows);
  const costTotal = materialTotal + labourTotal + staffTotal + otherTotal;
  const profit = workTotal - costTotal;

  // Lines of the same activity at the same location typed one after another form one numbered activity, like the sheet.
  const activities: { no: number; name: string; location: string | null; rows: WorkRow[]; total: number }[] = [];
  for (const r of workRows) {
    const last = activities.at(-1);
    if (last && last.name === r.activity && last.location === r.location) last.rows.push(r);
    else activities.push({ no: activities.length + 1, name: r.activity, location: r.location, rows: [r], total: 0 });
    activities.at(-1)!.total += Number(r.amount_paise);
  }

  const error = params.error && (ERRORS.has(params.error) ? t(`report.errors.${params.error}`) : params.error);
  const unitChoices = (units ?? []).filter((u) => u.is_active)
    .map((u) => ({ id: u.id as string, name: u.name as string, measure: u.measure as Measure }));
  // Only stock is used up on a site; assets and rented things are not offered.
  const materialChoices = (materials ?? []).filter((m) => m.is_active && m.item_kind === 'consumable').map((m) => {
    const s = stock.get(m.id);
    return { id: m.id, name: m.name, unit: m.unit?.name ?? '', rate: s?.rate ?? null, left: s?.left ?? 0 };
  });
  const offered = new Set(materialChoices.map((m) => m.id));
  const mixChoices = (mixes ?? []).map((x) => ({
    id: x.id, name: x.name, unit: x.unit?.name ?? '',
    items: [...x.items].sort((a, b) => a.position - b.position).filter((i) => offered.has(i.material_id))
      .map((i) => ({ materialId: i.material_id, quantity: Number(i.quantity) })),
  }));
  const canRemove = (createdBy: string) => office || createdBy === profile.user_id;
  const remove = (table: 'material_use' | 'work_done' | 'labour_day' | 'other_cost', id: string) => (
    <form action={removeReportLine.bind(null, table, id, site.id, date)}>
      <button type="submit" className="btn ghost small icon-btn" aria-label={t('report.remove')}><Icon name="close" size={16} /></button>
    </form>
  );
  const dayLink = (days: number) => `/report?site=${site.id}&date=${shiftDate(date, days)}`;

  const working = await getWorkingFirm();
  const accounts = await payAccounts(db, profile.role, working?.firm.id);
  const sheet: SheetData = {
    firm: working?.firm.name ?? null,
    site: site.name,
    date: showDate(date),
    preparedBy: profile.full_name,
    printedOn: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
    work: activities.map((a) => ({ no: a.no, name: a.name, location: a.location, total: a.total, rows: a.rows.map((r) => ({
      id: r.id, measurement: r.measurement, quantity: Number(r.quantity), unit: unitName.get(r.unit_id) ?? '',
      rate: Number(r.rate_paise), amount: Number(r.amount_paise),
    })) })),
    material: usedGroups.map((g) => ({ name: g.name, total: g.total, rows: g.rows.map((r) => {
      const s = stock.get(r.material_id);
      return { id: r.id, name: material.get(r.material_id)?.name ?? '', quantity: Number(r.quantity), unit: unitOf(r.material_id),
        rate: rateOf(r), amount: amount(r), left: s ? `${QTY.format(s.left)} ${unitOf(r.material_id)}` : '', remark: r.remark ?? '' };
    }) })),
    labour: labourRows.map((r) => ({ id: r.id, name: person.get(r.party_id)?.name ?? '', staff: isStaff(r), present: r.present,
      ot: Number(r.ot_hours), dayPay: Number(r.day_pay_paise), amount: Number(r.amount_paise) })),
    other: otherRows.map((r) => ({ id: r.id, description: r.description, head: t(`options.cost_head.${r.cost_head}`),
      quantity: Number(r.quantity), rate: Number(r.rate_paise), amount: Number(r.amount_paise) })),
    staffPay: office,
    totals: { work: workTotal, material: materialTotal, labour: labourTotal, staff: staffTotal, other: otherTotal, cost: costTotal, profit },
  };

  return (
    <>
      <div className="no-print">
      <div className="ledger-head">
        <div>
          <h1>{t('report.title')}</h1>
        </div>
        <PrintButton label={t('report.print')} title={`${t('report.title')} - ${site.name} - ${showDate(date)}`} />
      </div>
      <Help className="lede" title={t('report.help')}>{t('report.lede')}</Help>

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

      <ReportParts label={t('report.parts.label')} parts={[
        { key: 'work', name: t('report.parts.work'), done: workRows.length > 0, panel: (
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
            <table className="ledger saved-work stack">
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
                      <td className="num muted s-hide">{lineSerial(a.no, i, a.rows.length)}</td>
                      <td className="s-name">{i === 0 && <><strong>{a.name}</strong>{a.location && <div className="muted">{a.location}</div>}</>}</td>
                      <td className="s-meta">{r.measurement}</td>
                      <td className="num s-meta">{QTY.format(Number(r.quantity))} {unitName.get(r.unit_id)}</td>
                      <td className="num s-meta" data-x>{showPaise(Number(r.rate_paise))}</td>
                      <td className="num s-amt">{showPaise(Number(r.amount_paise))}</td>
                      <td className="s-x">{canRemove(r.created_by) && remove('work_done', r.id)}</td>
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

        <WorkDoneForm key={`${site.id}/${date}`} units={unitChoices} action={addWorkDone.bind(null, site.id, date)} />
      </section>
        ) },
        { key: 'material', name: t('report.parts.material'), done: usedToday.length > 0, panel: (
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
            <table className="ledger saved-work stack">
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
              {usedGroups.map((g) => (
                <tbody key={g.name}>
                {(g.name || usedGroups.length > 1) && (
                  <tr className="subtotal group-head">
                    <td colSpan={3}>{g.name || t('report.otherMaterials')}</td>
                    <td className="num">{showPaise(g.total)}</td>
                    <td colSpan={3} />
                  </tr>
                )}
                {g.rows.map((r) => {
                  const s = stock.get(r.material_id);
                  return (
                    <tr key={r.id} className={g.name ? 'in-group' : undefined}>
                      <td className="s-name"><strong>{material.get(r.material_id)?.name}</strong></td>
                      <td className="num s-meta">{QTY.format(Number(r.quantity))} {unitOf(r.material_id)}</td>
                      <td className="num s-meta" data-x>{rateOf(r) === null ? '—' : showPaise(Math.round(rateOf(r)!))}</td>
                      <td className="num s-amt">{showPaise(amount(r))}</td>
                      <td className={s && s.left < 0 ? 'num minus s-meta' : 'num s-meta'} data-label={t('report.left')} title={s && s.left < 0 ? t('stock.belowZero') : undefined}>
                        {s ? `${QTY.format(s.left)} ${unitOf(r.material_id)}` : ''}
                      </td>
                      <td className="s-meta">{r.remark}</td>
                      <td className="s-x">{canRemove(r.created_by) && remove('material_use', r.id)}</td>
                    </tr>
                  );
                })}
                </tbody>
              ))}
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

        <MaterialUseForm key={`${site.id}/${date}`} materials={materialChoices} mixes={mixChoices} units={unitChoices.map((u) => ({ value: u.id, label: u.name }))} action={addMaterialUse.bind(null, site.id, date)} />
      </section>
        ) },
        { key: 'labour', name: t('report.parts.labour'), done: labourRows.length > 0, panel: (
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
            <table className="ledger stack">
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
                      <td className="num muted s-hide">{i + 1}</td>
                      <td className="s-name">
                        <strong>{p?.name}</strong>
                        {kind === 'staff' && <span className="pill common small-pill">{t('report.labour.staff')}</span>}
                      </td>
                      <td className="s-meta"><span className={`pill ${r.present ? 'verified' : 'pending'}`}>{t(`report.labour.mark.${r.present ? 'P' : 'A'}`)}</span></td>
                      <td className={Number(r.ot_hours) > 0 ? 'num s-meta' : 'num s-hide'}>{Number(r.ot_hours) > 0 ? t('report.labour.otHours', { n: Number(r.ot_hours) }) : '–'}</td>
                      <td className="num s-hide">{r.present && (office || kind !== 'staff') ? showPaise(Number(r.day_pay_paise)) : '–'}</td>
                      <td className="num s-amt">{office || kind !== 'staff' ? showPaise(Number(r.amount_paise)) : '–'}</td>
                      <td className="s-x">{canRemove(r.created_by) && remove('labour_day', r.id)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td /><td colSpan={4}>{t('report.labourTotal')}</td><td className="num">{showPaise(labourTotal)}</td><td /></tr>
                {office && <tr><td /><td colSpan={4}>{t('report.staffTotal')}</td><td className="num">{showPaise(staffTotal)}</td><td /></tr>}
              </tfoot>
            </table>
          </div>
        )}

        {unmarked.length > 0 ? (
          <LabourForm key={`${site.id}/${date}/${[...marked].join()}`} people={unmarked} action={addLabour.bind(null, site.id, date)} />
        ) : (
          <p className="card empty-state">
            {t(labourRows.length ? 'report.allMarked' : 'report.noWorkers')}{' '}
            {office && <Link href="/masters/workers">{t('report.workerList')}</Link>}
          </p>
        )}
      </section>
        ) },
        { key: 'other', name: t('report.parts.other'), done: otherRows.length > 0, panel: (
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
            <table className="ledger stack">
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
                    <td className="s-name"><strong>{r.description}</strong>{r.entry_id && <span className="pill cleared">{t('report.other.paid')}</span>}
                      {!r.entry_id && r.on_bill && <span className="pill common small-pill">{t('unpaid.onBill')}</span>}
                      {!r.entry_id && !r.on_bill && accounts.length > 0 && Number(r.amount_paise) > 0 && (
                        <details className="pay-cost no-print">
                          <summary className="btn ghost small">{t('report.other.payNow')}</summary>
                          <form action={payCost.bind(null, r.id, crypto.randomUUID(), site.id, date)}>
                            <select name="account" required defaultValue="" aria-label={t('report.other.paidFrom')}><option value="">{t('bankbook.popup.pick')}</option><AccountOptions accounts={accounts} /></select>
                            <input type="date" name="date" required defaultValue={today} max={today} aria-label={t('fields.entry_date')} />
                            <button type="submit" className="btn small">{t('payList.party.button')}</button>
                          </form>
                        </details>
                      )}</td>
                    <td className="s-meta">{t(`options.cost_head.${r.cost_head}`)}</td>
                    <td className="num s-meta">{QTY.format(Number(r.quantity))}</td>
                    <td className="num s-meta" data-x>{showPaise(Number(r.rate_paise))}</td>
                    <td className="num s-amt">{showPaise(Number(r.amount_paise))}</td>
                    <td className="s-x">{canRemove(r.created_by) && remove('other_cost', r.id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <OtherCostForm key={`${site.id}/${date}`} accounts={accounts} action={addOtherCost.bind(null, site.id, date)} />
      </section>
        ) },
        { key: 'profit', name: t('report.parts.profit'), done: false, panel: (
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
              {office ? <tr><td>{t('report.less', { what: t('report.staffTotal') })}</td><td className="num">{showPaise(staffTotal)}</td></tr>
                : <tr><td colSpan={2} className="muted">{t('report.noStaffPay')}</td></tr>}
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
        ) },
      ]} />
      </div>
      <PrintSheet d={sheet} />
    </>
  );
}
