import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { SearchSelect } from '@/components/search-select';
import { Tabs } from '@/components/tabs';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { QTY } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate, todayInIndia } from '../entries/data';
import { Arrivals, type ArrivalRow } from '../stock/arrivals';
import { Stat } from '../party/shared';
import { moveAsset, removeMove } from './actions';
import { holdings } from './held';

interface MoveRow {
  id: string;
  material_id: string;
  from_site_id: string;
  to_site_id: string;
  quantity: number | string;
  move_date: string;
  note: string;
  created_by: string;
}

/**
 * The company's assets (tools and the like, kept to reuse): what is at each site, what arrived, and the moves between
 * sites. Supervisors type what arrives (materials whose kind is Asset in Setup) and move them; not any site's stock.
 */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  const profile = await requireProfile();
  const office = profile.role !== 'supervisor';
  const { tab = 'now', error } = await searchParams;
  const t = await getTranslations();
  const db = await createClient();
  const [{ data: bought }, { data: moves }, { data: units }, { data: materials }, { data: sites }, names] = await Promise.all([
    db.from('asset_in_rows').select('*').order('entry_date', { ascending: false }).returns<ArrivalRow[]>(),
    db.from('asset_moves').select('id, material_id, from_site_id, to_site_id, quantity, move_date, note, created_by')
      .order('move_date', { ascending: false }).order('created_at', { ascending: false }).returns<MoveRow[]>(),
    db.from('units').select('id, name').eq('is_active', true).order('name'),
    db.from('materials').select('id, name, is_active, item_kind, unit:units(name)').order('name')
      .returns<{ id: string; name: string; is_active: boolean; item_kind: string; unit: { name: string } | null }[]>(),
    db.from('sites').select('id, name').eq('is_active', true).order('name'),
    loadNames(db),
  ]);
  const boughtRows = bought ?? [];
  const moveRows = moves ?? [];
  const material = new Map((materials ?? []).map((m) => [m.id, m]));
  const qty = (n: number, id: string) => `${QTY.format(n)} ${material.get(id)?.unit?.name ?? ''}`.trim();

  // Each asset is valued at its average rate over the lines that came with one.
  const cost = new Map<string, { qty: number; paise: number }>();
  for (const b of boughtRows) {
    if (b.amount_paise === null) continue;
    const c = cost.get(b.material_id) ?? { qty: 0, paise: 0 };
    cost.set(b.material_id, { qty: c.qty + Number(b.quantity), paise: c.paise + Number(b.amount_paise) });
  }
  const valueOf = (id: string, n: number) => {
    const c = cost.get(id);
    return c && c.qty > 0 ? Math.round((c.paise / c.qty) * n) : 0;
  };
  const sortName = (h: { material_id: string; site_id: string }) =>
    `${material.get(h.material_id)?.name ?? ''} ${names.sites.get(h.site_id) ?? ''}`;
  const held = holdings(boughtRows, moveRows).filter((h) => h.now > 1e-9).sort((a, b) => sortName(a).localeCompare(sortName(b)));
  const totalValue = held.reduce((s, h) => s + valueOf(h.material_id, h.now), 0);
  const assetChoices = [...new Set(held.map((h) => h.material_id))].map((id) => ({ value: id, label: material.get(id)?.name ?? '?' }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const siteChoices = (sites ?? []).map((s) => ({ value: s.id as string, label: s.name as string }));

  return (
    <>
      <h1>{t('assets.title')}</h1>
      <p className="lede">{t('assets.lede')}</p>
      {error && <p role="alert" className="error form-error">{t.has(`assets.errors.${error}`) ? t(`assets.errors.${error}`) : error}</p>}
      <div className="stats">
        <Stat label={t('assets.value')} value={showPaise(totalValue)} note={t('assets.valueNote')} />
        <Stat label={t('assets.kinds')} value={String(new Set(held.map((h) => h.material_id)).size)}
          note={t('assets.atSites', { count: new Set(held.map((h) => h.site_id)).size })} />
      </div>
      <Tabs initial={tab} tabs={[
        { key: 'now', label: t('assets.tabNow'), count: held.length, panel: held.length === 0 ? (
          <p className="card empty">{t('assets.none')}</p>
        ) : (
          <div className="card table-wrap flush">
            <table className="ledger">
              <thead>
                <tr>
                  <th>{t('assets.asset')}</th>
                  <th>{t('assets.site')}</th>
                  <th className="num">{t('assets.arrivedHere')}</th>
                  <th className="num">{t('assets.movedIn')}</th>
                  <th className="num">{t('assets.movedOut')}</th>
                  <th className="num">{t('assets.atSiteNow')}</th>
                  <th className="num">{t('assets.worth')}</th>
                </tr>
              </thead>
              <tbody>
                {held.map((h) => (
                  <tr key={`${h.material_id}|${h.site_id}`}>
                    <td>{material.get(h.material_id)?.name}</td>
                    <td>{names.sites.get(h.site_id)}</td>
                    <td className="num">{h.bought ? qty(h.bought, h.material_id) : '–'}</td>
                    <td className="num">{h.movedIn ? qty(h.movedIn, h.material_id) : '–'}</td>
                    <td className="num">{h.movedOut ? qty(h.movedOut, h.material_id) : '–'}</td>
                    <td className="num"><strong>{qty(h.now, h.material_id)}</strong></td>
                    <td className="num">{showPaise(valueOf(h.material_id, h.now))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) },
        { key: 'arrived', label: t('arrivals.tab'), count: boughtRows.length, panel: (
          <Arrivals page="/assets" rows={boughtRows} t={t}
            materials={(materials ?? []).filter((m) => m.is_active && m.item_kind === 'asset')
              .map((m) => ({ value: m.id, label: m.unit ? `${m.name} (${m.unit.name})` : m.name }))}
            units={(units ?? []).map((u) => ({ value: u.id as string, label: u.name as string }))} sites={siteChoices}
            materialName={(id) => material.get(id)?.name ?? ''} unitOf={(id) => material.get(id)?.unit?.name ?? ''}
            siteName={(id) => names.sites.get(id) ?? ''} canRemove={(by) => office || by === profile.user_id} />
        ) },
        { key: 'moves', label: t('assets.tabMoves'), count: moveRows.length, panel: (
          <>
            <form action={moveAsset} className="card asset-move">
              <p className="bill-section">{t('assets.moveTitle')}</p>
              <div className="asset-move-grid">
                <div className="field wide">
                  <label htmlFor="mv-asset">{t('assets.asset')}</label>
                  <SearchSelect id="mv-asset" name="material_id" options={assetChoices} required placeholder={t('common.choose')} />
                </div>
                <div className="field">
                  <label htmlFor="mv-qty">{t('assets.howMany')}</label>
                  <input id="mv-qty" name="quantity" inputMode="decimal" autoComplete="off" required className="num" />
                </div>
                <div className="field">
                  <label htmlFor="mv-from">{t('assets.from')}</label>
                  <SearchSelect id="mv-from" name="from_site_id" options={siteChoices} required placeholder={t('common.choose')} />
                </div>
                <div className="field">
                  <label htmlFor="mv-to">{t('assets.to')}</label>
                  <SearchSelect id="mv-to" name="to_site_id" options={siteChoices} required placeholder={t('common.choose')} />
                </div>
                <div className="field">
                  <label htmlFor="mv-date">{t('assets.date')}</label>
                  <input id="mv-date" type="date" name="move_date" defaultValue={todayInIndia()} max={todayInIndia()} required />
                </div>
                <div className="field wide">
                  <label htmlFor="mv-note">{t('fields.narration')}<span className="optional"> {t('common.optional')}</span></label>
                  <input id="mv-note" name="note" autoComplete="off" placeholder={t('assets.notePlaceholder')} />
                </div>
              </div>
              <button type="submit" className="btn"><Icon name="arrowRight" /> {t('assets.move')}</button>
            </form>
            {moveRows.length > 0 && (
              <div className="card table-wrap flush">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>{t('assets.date')}</th>
                      <th>{t('assets.asset')}</th>
                      <th className="num">{t('assets.qty')}</th>
                      <th>{t('assets.from')}</th>
                      <th>{t('assets.to')}</th>
                      <th>{t('fields.narration')}</th>
                      <th aria-label={t('assets.remove')} />
                    </tr>
                  </thead>
                  <tbody>
                    {moveRows.map((m) => (
                      <tr key={m.id}>
                        <td className="nowrap">{showDate(m.move_date)}</td>
                        <td>{material.get(m.material_id)?.name}</td>
                        <td className="num">{qty(Number(m.quantity), m.material_id)}</td>
                        <td>{names.sites.get(m.from_site_id)}</td>
                        <td>{names.sites.get(m.to_site_id)}</td>
                        <td>{m.note}</td>
                        <td>
                          {(office || m.created_by === profile.user_id) && (
                            <form action={removeMove.bind(null, m.id)}>
                              <button type="submit" className="btn ghost small icon-btn" aria-label={t('assets.remove')}>
                                <Icon name="close" size={16} />
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) },
      ]} />
    </>
  );
}
