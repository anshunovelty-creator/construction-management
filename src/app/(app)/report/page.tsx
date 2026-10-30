import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { QTY, stockLines, valueOf, type Bought, type Used } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import { showDate, todayInIndia } from '../entries/data';
import { addMaterialUse, removeMaterialUse } from './actions';

interface UseRow extends Used {
  id: string;
  remark: string;
  created_by: string;
}

/** Empty lines on the form; more can be added after saving. */
const NEW_LINES = 6;
const ERRORS = new Set(['pick_material', 'bad_quantity', 'nothing', 'not_removed']);

/**
 * A site's daily report, part 1: the material used that day. Supervisors fill it for their own sites; each line comes
 * out of the site's stock. The office also sees each material's rate (the average bought at the site up to that day),
 * the amount, and what is left.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ site?: string; date?: string; error?: string }> }) {
  const profile = await requireProfile('owner', 'office', 'supervisor');
  const office = profile.role !== 'supervisor';
  const t = await getTranslations();
  const db = await createClient();
  const params = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : todayInIndia();

  // Supervisors see only the sites given to them in People.
  const [{ data: allSites }, { data: mySites }, { data: materials }] = await Promise.all([
    db.from('sites').select('id, name').eq('is_active', true).order('name'),
    office ? Promise.resolve({ data: null }) : db.from('user_sites').select('site_id').eq('user_id', profile.user_id),
    db.from('materials').select('id, name, is_active, unit:units(name)')
      .order('name').returns<{ id: string; name: string; is_active: boolean; unit: { name: string } | null }[]>(),
  ]);
  const mine = mySites && new Set(mySites.map((s) => s.site_id as string));
  const sites = (allSites ?? []).filter((s) => !mine || mine.has(s.id));
  if (sites.length === 0) return <p className="empty">{t('report.noSites')}</p>;
  const site = sites.find((s) => s.id === params.site) ?? sites[0]!;
  const material = new Map((materials ?? []).map((m) => [m.id, m]));
  const unit = (id: string) => material.get(id)?.unit?.name ?? '';

  const [{ data: used }, { data: bought }] = await Promise.all([
    db.from('material_use').select('id, site_id, material_id, use_date, quantity, remark, created_by')
      .eq('site_id', site.id).lte('use_date', date).order('created_at').returns<UseRow[]>(),
    office
      ? db.from('stock_in_rows').select('site_id, material_id, entry_date, quantity, amount_paise').eq('site_id', site.id).returns<Bought[]>()
      : Promise.resolve({ data: [] as Bought[] }),
  ]);
  const today = (used ?? []).filter((r) => r.use_date === date);
  const stock = new Map(stockLines(bought ?? [], used ?? [], date).map((s) => [s.material_id, s]));
  const amount = (r: UseRow) => valueOf(Number(r.quantity), stock.get(r.material_id)?.rate ?? null);
  const total = today.reduce((sum, r) => sum + amount(r), 0);
  const error = params.error && (ERRORS.has(params.error) ? t(`report.errors.${params.error}`) : params.error);

  return (
    <>
      <h1>{t('report.title')}</h1>
      <p className="lede">{t('report.lede')}</p>

      <form className="filters" method="get">
        <select name="site" defaultValue={site.id} aria-label={t('report.site')}>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" name="date" defaultValue={date} aria-label={t('report.date')} />
        <button type="submit" className="btn ghost small">{t('report.open')}</button>
      </form>

      {error && <p className="banner bad">{error}</p>}

      <div className="card">
        <h2>{t('report.materialTitle', { site: site.name, date: showDate(date) })}</h2>
        {today.length === 0 ? (
          <p className="empty">{t('report.noneUsed')}</p>
        ) : (
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>{t('report.material')}</th>
                  <th>{t('report.unit')}</th>
                  <th className="num">{t('report.used')}</th>
                  {office && <th className="num">{t('report.rate')}</th>}
                  {office && <th className="num">{t('report.amount')}</th>}
                  {office && <th className="num">{t('report.left')}</th>}
                  <th>{t('report.remark')}</th>
                  <th aria-label={t('report.remove')} />
                </tr>
              </thead>
              <tbody>
                {today.map((r) => {
                  const s = stock.get(r.material_id);
                  return (
                    <tr key={r.id}>
                      <td>{material.get(r.material_id)?.name}</td>
                      <td>{unit(r.material_id)}</td>
                      <td className="num">{QTY.format(Number(r.quantity))}</td>
                      {office && <td className="num">{s?.rate == null ? '' : showPaise(Math.round(s.rate))}</td>}
                      {office && <td className="num">{showPaise(amount(r))}</td>}
                      {office && (
                        <td className={s && s.left < 0 ? 'num minus' : 'num'} title={s && s.left < 0 ? t('stock.belowZero') : undefined}>
                          {s ? `${QTY.format(s.left)} ${unit(r.material_id)}` : ''}
                        </td>
                      )}
                      <td>{r.remark}</td>
                      <td>
                        {(office || r.created_by === profile.user_id) && (
                          <form action={removeMaterialUse.bind(null, r.id, site.id, date)}>
                            <button type="submit" className="btn ghost small" aria-label={t('report.remove')}>✕</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {office && (
                <tfoot>
                  <tr>
                    <td colSpan={4}>{t('report.total')}</td>
                    <td className="num"><strong>{showPaise(total)}</strong></td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      <form action={addMaterialUse.bind(null, site.id, date)} className="card">
        <h2>{t('report.addTitle')}</h2>
        <p className="hint">{t('report.addHint')}</p>
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>{t('report.material')}</th>
                <th className="num">{t('report.used')}</th>
                <th>{t('report.remark')}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: NEW_LINES }, (_, i) => (
                <tr key={i}>
                  <td>
                    <select name="material" defaultValue="" aria-label={t('report.material')}>
                      <option value="">—</option>
                      {(materials ?? []).filter((m) => m.is_active).map((m) => (
                        <option key={m.id} value={m.id}>{m.unit ? `${m.name} (${m.unit.name})` : m.name}</option>
                      ))}
                    </select>
                  </td>
                  <td><input name="quantity" inputMode="decimal" className="num" aria-label={t('report.used')} /></td>
                  <td><input name="remark" aria-label={t('report.remark')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="submit" className="btn">{t('report.save')}</button>
      </form>
    </>
  );
}
