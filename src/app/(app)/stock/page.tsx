import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Tabs } from '@/components/tabs';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { QTY, stockLines, valueOf, type Bought, type Used } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate } from '../entries/data';

interface StockInRow extends Bought {
  entry_id: string;
  line_no: number;
  serial: string;
  reference: string;
  party_id: string;
  rate_paise: number | string;
}

/**
 * Stock at each site, whichever firm bought it. Everything bought on a party's bill comes in by itself;
 * what the supervisors report used on the daily report goes out.
 */
export default async function StockPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireProfile('owner', 'office');
  const { tab = 'stock' } = await searchParams;
  const t = await getTranslations();
  const db = await createClient();
  const [{ data }, { data: usedRows }, { data: materials }, names] = await Promise.all([
    db.from('stock_in_rows').select('*').order('entry_date').order('serial').order('line_no').returns<StockInRow[]>(),
    db.from('material_use').select('site_id, material_id, use_date, quantity').returns<Used[]>(),
    db.from('materials').select('id, name, unit:units(name)').returns<{ id: string; name: string; unit: { name: string } | null }[]>(),
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
        { key: 'bought', label: t('stock.bought'), count: rows.length, panel: rows.length === 0 ? (
          <p className="card empty">{t('stock.none')}</p>
        ) : (
          <div className="card table-wrap flush">
            <table className="ledger">
              <thead>
                <tr>
                  <th>{t('stock.date')}</th>
                  <th>{t('stock.bill')}</th>
                  <th>{t('stock.party')}</th>
                  <th>{t('stock.material')}</th>
                  <th>{t('stock.site')}</th>
                  <th className="num">{t('stock.quantity')}</th>
                  <th className="num">{t('stock.rate')}</th>
                  <th className="num">{t('stock.cost')}</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={`${r.entry_id}|${r.line_no}`}>
                    <td className="nowrap">{showDate(r.entry_date)}</td>
                    <td>
                      <Link href={`/entries/${r.entry_id}`} className="serial underline">{r.serial}</Link>{' '}
                      <span className="muted">{r.reference}</span>
                    </td>
                    <td>{names.parties.get(r.party_id)}</td>
                    <td>{material.get(r.material_id)?.name}</td>
                    <td>{names.sites.get(r.site_id)}</td>
                    <td className="num">{qty(Number(r.quantity), r.material_id)}</td>
                    <td className="num">{showPaise(Number(r.rate_paise))}</td>
                    <td className="num">{showPaise(Number(r.amount_paise))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) },
      ]} />
    </>
  );
}
