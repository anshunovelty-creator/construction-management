import { getTranslations } from 'next-intl/server';
import { Tabs } from '@/components/tabs';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { QTY, stockLines, valueOf, type Used } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import { loadNames } from '../entries/data';
import { Arrivals, type ArrivalRow } from './arrivals';

/**
 * Stock at each site, whichever firm paid for it. Supervisors type what arrives at their sites (with its rate when
 * they know it); what they report used on the daily report goes out. Supervisors see their own sites only.
 */
export default async function StockPage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  const profile = await requireProfile();
  const office = profile.role !== 'supervisor';
  const { tab = 'stock', error } = await searchParams;
  const t = await getTranslations();
  const db = await createClient();
  const [{ data }, { data: usedRows }, { data: materials }, { data: sites }, names] = await Promise.all([
    db.from('stock_in_rows').select('*').order('entry_date', { ascending: false }).returns<ArrivalRow[]>(),
    db.from('material_use').select('site_id, material_id, use_date, quantity').returns<Used[]>(),
    db.from('materials').select('id, name, is_active, item_kind, unit:units(name)').order('name')
      .returns<{ id: string; name: string; is_active: boolean; item_kind: string; unit: { name: string } | null }[]>(),
    db.from('sites').select('id, name').eq('is_active', true).order('name'),
    loadNames(db),
  ]);
  const rows = data ?? [];
  const material = new Map((materials ?? []).map((m) => [m.id, m]));
  const qty = (n: number, materialId: string) => `${QTY.format(n)} ${material.get(materialId)?.unit?.name ?? ''}`.trim();

  const sortName = (s: { material_id: string; site_id: string }) =>
    `${material.get(s.material_id)?.name ?? ''} ${names.sites.get(s.site_id) ?? ''}`;
  const lines = stockLines(rows, usedRows ?? []).sort((a, b) => sortName(a).localeCompare(sortName(b)));
  const value = lines.reduce((sum, s) => sum + valueOf(Math.max(s.left, 0), s.rate), 0);

  return (
    <>
      <h1>{t('stock.title')}</h1>
      <p className="lede">{t('stock.lede')}</p>
      {error && <p role="alert" className="error form-error">{t.has(`arrivals.errors.${error}`) ? t(`arrivals.errors.${error}`) : error}</p>}
      <dl className="bill-totals">
        <div><dt>{t('stock.value')}</dt><dd>{showPaise(value)}</dd></div>
      </dl>
      <Tabs initial={tab} tabs={[
        { key: 'stock', label: t('stock.inStock'), count: lines.length, panel: lines.length === 0 ? (
          <p className="card empty">{t('stock.none')}</p>
        ) : (
          <div className="card table-wrap flush">
            <table className="ledger">
              <thead>
                <tr>
                  <th>{t('stock.material')}</th>
                  <th>{t('stock.site')}</th>
                  <th className="num">{t('stock.boughtQty')}</th>
                  <th className="num">{t('stock.usedQty')}</th>
                  <th className="num">{t('stock.left')}</th>
                  <th className="num">{t('stock.avgRate')}</th>
                  <th className="num">{t('stock.leftValue')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((s) => (
                  <tr key={`${s.material_id}|${s.site_id}`}>
                    <td>{material.get(s.material_id)?.name}</td>
                    <td>{names.sites.get(s.site_id)}</td>
                    <td className="num">{qty(s.bought, s.material_id)}</td>
                    <td className="num">{qty(s.used, s.material_id)}</td>
                    <td className={s.left < 0 ? 'num minus' : 'num'} title={s.left < 0 ? t('stock.belowZero') : undefined}>
                      <strong>{qty(s.left, s.material_id)}</strong>
                    </td>
                    <td className="num">{s.rate === null ? '' : showPaise(Math.round(s.rate))}</td>
                    <td className="num">{showPaise(valueOf(Math.max(s.left, 0), s.rate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) },
        { key: 'arrived', label: t('arrivals.tab'), count: rows.length, panel: (
          <Arrivals page="/stock" rows={rows} t={t}
            materials={(materials ?? []).filter((m) => m.is_active && m.item_kind === 'consumable')
              .map((m) => ({ value: m.id, label: m.unit ? `${m.name} (${m.unit.name})` : m.name }))}
            sites={(sites ?? []).map((x) => ({ value: x.id as string, label: x.name as string }))}
            materialName={(id) => material.get(id)?.name ?? ''} unitOf={(id) => material.get(id)?.unit?.name ?? ''}
            siteName={(id) => names.sites.get(id) ?? ''} canRemove={(by) => office || by === profile.user_id} />
        ) },
      ]} />
    </>
  );
}
