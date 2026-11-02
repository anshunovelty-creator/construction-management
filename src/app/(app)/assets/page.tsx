import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { SearchSelect } from '@/components/search-select';
import { Tabs } from '@/components/tabs';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { QTY } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate, todayInIndia } from '../entries/data';
import { Stat } from '../party/shared';
import { moveAsset, removeMove } from './actions';
import { holdings } from './held';

interface BoughtRow {
  entry_id: string;
  line_no: number;
  serial: string;
  entry_date: string;
  reference: string;
  party_id: string;
  site_id: string | null;
  material_id: string;
  quantity: number | string;
  rate_paise: number | string;
  amount_paise: number | string;
}

interface MoveRow {
  id: string;
  material_id: string;
  from_site_id: string;
  to_site_id: string;
  quantity: number | string;
  move_date: string;
  note: string;
}

/**
 * The company's assets (tools and the like, bought to reuse): what is at each site, what was bought, and the moves
 * between sites. They come in from party bills whose lines are "Asset"; they are not any site's cost or stock.
 */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  await requireProfile('owner', 'office');
  const { tab = 'now', error } = await searchParams;
  const t = await getTranslations();
  const db = await createClient();
  const [{ data: bought }, { data: moves }, { data: materials }, { data: sites }, names] = await Promise.all([
    db.from('asset_in_rows').select('*').order('entry_date', { ascending: false }).returns<BoughtRow[]>(),
    db.from('asset_moves').select('id, material_id, from_site_id, to_site_id, quantity, move_date, note')
      .order('move_date', { ascending: false }).order('created_at', { ascending: false }).returns<MoveRow[]>(),
    db.from('materials').select('id, name, unit:units(name)').returns<{ id: string; name: string; unit: { name: string } | null }[]>(),
    db.from('sites').select('id, name').eq('is_active', true).order('name'),
    loadNames(db),
  ]);
  const boughtRows = bought ?? [];
  const moveRows = moves ?? [];
  const material = new Map((materials ?? []).map((m) => [m.id, m]));
  const qty = (n: number, id: string) => `${QTY.format(n)} ${material.get(id)?.unit?.name ?? ''}`.trim();

  // Each asset is valued at what it cost on average across every bill it was bought on.
  const cost = new Map<string, { qty: number; paise: number }>();
  for (const b of boughtRows) {
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
  const assetChoices = [...cost.keys()].map((id) => ({ value: id, label: material.get(id)?.name ?? '?' }))
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
                  <th className="num">{t('assets.boughtHere')}</th>
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
        { key: 'bought', label: t('assets.tabBought'), count: boughtRows.length, panel: boughtRows.length === 0 ? (
          <p className="card empty">{t('assets.noneBought')}</p>
        ) : (
          <div className="card table-wrap flush">
            <table className="ledger">
              <thead>
                <tr>
                  <th>{t('assets.date')}</th>
                  <th>{t('assets.bill')}</th>
                  <th>{t('assets.party')}</th>
                  <th>{t('assets.asset')}</th>
                  <th>{t('assets.site')}</th>
                  <th className="num">{t('assets.qty')}</th>
                  <th className="num">{t('assets.rate')}</th>
                  <th className="num">{t('assets.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {boughtRows.map((r) => (
                  <tr key={`${r.entry_id}|${r.line_no}`}>
                    <td className="nowrap">{showDate(r.entry_date)}</td>
                    <td>
                      <Link href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</Link>{' '}
                      <span className="muted">{r.reference}</span>
                    </td>
                    <td>{names.parties.get(r.party_id)}</td>
                    <td>{material.get(r.material_id)?.name}</td>
                    <td>{r.site_id ? names.sites.get(r.site_id) : ''}</td>
                    <td className="num">{qty(Number(r.quantity), r.material_id)}</td>
                    <td className="num">{showPaise(Number(r.rate_paise))}</td>
                    <td className="num">{showPaise(Number(r.amount_paise))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                          <form action={removeMove.bind(null, m.id)}>
                            <button type="submit" className="btn ghost small icon-btn" aria-label={t('assets.remove')}>
                              <Icon name="close" size={16} />
                            </button>
                          </form>
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
