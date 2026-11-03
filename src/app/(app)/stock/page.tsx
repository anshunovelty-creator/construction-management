import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { PrintButton } from '@/components/print-button';
import { SearchSelect } from '@/components/search-select';
import { Tabs } from '@/components/tabs';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { QTY, stockLines, stockRegister, valueOf, type Used } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate, todayInIndia } from '../entries/data';
import { Arrivals, type ArrivalRow } from './arrivals';

interface UseRow extends Used { id: string; remark: string; rate_paise: number | string | null }

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Stock at each site, whichever firm paid for it, for a period: what was there at the start, what arrived (typed by
 * the supervisors), what was used (from the daily reports) and what is left. Supervisors see their own sites only.
 */
export default async function StockPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; error?: string; site?: string; from?: string; to?: string }>;
}) {
  const profile = await requireProfile();
  const office = profile.role !== 'supervisor';
  const params = await searchParams;
  const today = todayInIndia();
  const to = DATE.test(params.to ?? '') ? params.to! : today;
  const from = DATE.test(params.from ?? '') && params.from! <= to ? params.from! : `${to.slice(0, 8)}01`;
  const t = await getTranslations();
  const db = await createClient();
  const [{ data: sites }, { data: units }, { data: materials }, names] = await Promise.all([
    db.from('sites').select('id, name').eq('is_active', true).order('name'),
    db.from('units').select('id, name').eq('is_active', true).order('name'),
    db.from('materials').select('id, name, is_active, item_kind, unit:units(name)').order('name')
      .returns<{ id: string; name: string; is_active: boolean; item_kind: string; unit: { name: string } | null }[]>(),
    loadNames(db),
  ]);
  const siteChoices = (sites ?? []).map((x) => ({ value: x.id as string, label: x.name as string }));
  const site = siteChoices.some((s) => s.value === params.site) ? params.site! : '';

  // Everything up to the period's end: the opening stock needs what came before it.
  let inQuery = db.from('stock_in_rows').select('*').lte('entry_date', to);
  let useQuery = db.from('material_use').select('id, site_id, material_id, use_date, quantity, rate_paise, remark').lte('use_date', to);
  if (site) {
    inQuery = inQuery.eq('site_id', site);
    useQuery = useQuery.eq('site_id', site);
  }
  const [{ data: inData }, { data: useData }] = await Promise.all([
    inQuery.order('entry_date', { ascending: false }).returns<ArrivalRow[]>(),
    useQuery.order('use_date', { ascending: false }).order('created_at', { ascending: false }).returns<UseRow[]>(),
  ]);
  const bought = inData ?? [];
  const used = useData ?? [];
  const arrivedRows = bought.filter((r) => r.entry_date >= from);
  const usedRows = used.filter((r) => r.use_date >= from);

  const material = new Map((materials ?? []).map((m) => [m.id, m]));
  const unitOf = (id: string) => material.get(id)?.unit?.name ?? '';
  const qty = (n: number, id: string) => `${QTY.format(n)} ${unitOf(id)}`.trim();
  const siteName = (id: string) => names.sites.get(id) ?? '';
  const sortName = (s: { material_id: string; site_id: string }) => `${material.get(s.material_id)?.name ?? ''} ${siteName(s.site_id)}`;
  const lines = stockRegister(bought, used, from, to).sort((a, b) => sortName(a).localeCompare(sortName(b)));
  const value = lines.reduce((sum, s) => sum + valueOf(Math.max(s.closing, 0), s.rate), 0);
  // A use is valued at the rate the supervisor gave it, else the average rate of what had arrived at that site by that
  // day, as on its daily report.
  const rateOn = (r: UseRow) => r.rate_paise !== null ? Number(r.rate_paise)
    : stockLines(bought.filter((b) => b.site_id === r.site_id && b.material_id === r.material_id), [], r.use_date)[0]?.rate ?? null;
  const usedValue = usedRows.reduce((sum, r) => sum + valueOf(Number(r.quantity), rateOn(r)), 0);
  const period = `${showDate(from)} – ${showDate(to)}`;
  const passbookLink = (s: { site_id: string; material_id: string }) =>
    `/stock/material?site=${s.site_id}&material=${s.material_id}&from=${from}&to=${to}`;

  return (
    <>
      <div className="ledger-head">
        <div>
          <h1>{t('stock.title')}</h1>
          <p className="muted">{site ? siteName(site) : t('stock.allSites')} · {period}</p>
        </div>
        <PrintButton label={t('report.print')} title={`${t('stock.title')} - ${site ? siteName(site) : t('stock.allSites')} - ${period}`} />
      </div>
      <p className="lede no-print">{t('stock.lede')}</p>
      {params.error && (
        <p role="alert" className="error form-error">
          {t.has(`arrivals.errors.${params.error}`) ? t(`arrivals.errors.${params.error}`) : params.error}
        </p>
      )}

      <AutoForm action="/stock" className="card report-bar no-print">
        <label className="activity-field grow">
          <span>{t('stock.site')}</span>
          <SearchSelect name="site" defaultValue={site} options={siteChoices} emptyLabel={t('stock.allSites')}
            placeholder={t('stock.allSites')} submitOnPick />
        </label>
        <label className="activity-field">
          <span>{t('stock.from')}</span>
          <input type="date" name="from" defaultValue={from} max={to} required />
        </label>
        <label className="activity-field">
          <span>{t('stock.to')}</span>
          <input type="date" name="to" defaultValue={to} max={today} required />
        </label>
      </AutoForm>

      <dl className="bill-totals">
        <div><dt>{t('stock.usedValue')}</dt><dd>{showPaise(usedValue)}</dd></div>
        <div className="grand"><dt>{t('stock.value')}</dt><dd>{showPaise(value)}</dd></div>
      </dl>

      <Tabs initial={params.tab ?? 'stock'} tabs={[
        { key: 'stock', label: t('stock.register'), count: lines.length, panel: lines.length === 0 ? (
          <p className="card empty">{t('stock.none')}</p>
        ) : (
          <div className="card table-wrap flush">
            <table className="ledger statement">
              <thead>
                <tr>
                  <th>{t('stock.material')}</th>
                  <th>{t('stock.site')}</th>
                  <th className="num">{t('stock.opening')}</th>
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
                    <td><Link href={passbookLink(s)} className="underline">{material.get(s.material_id)?.name}</Link></td>
                    <td>{siteName(s.site_id)}</td>
                    <td className="num">{qty(s.opening, s.material_id)}</td>
                    <td className="num">{s.arrived ? qty(s.arrived, s.material_id) : <span className="muted">–</span>}</td>
                    <td className="num">{s.used ? qty(s.used, s.material_id) : <span className="muted">–</span>}</td>
                    <td className={s.closing < 0 ? 'num minus' : 'num'} title={s.closing < 0 ? t('stock.belowZero') : undefined}>
                      <strong>{qty(s.closing, s.material_id)}</strong>
                    </td>
                    <td className="num">{s.rate === null ? <span className="muted">–</span> : showPaise(Math.round(s.rate))}</td>
                    <td className="num">{showPaise(valueOf(Math.max(s.closing, 0), s.rate))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) },
        { key: 'arrived', label: t('arrivals.tab'), count: arrivedRows.length, panel: (
          <Arrivals page="/stock" rows={arrivedRows} t={t}
            materials={(materials ?? []).filter((m) => m.is_active && m.item_kind === 'consumable')
              .map((m) => ({ value: m.id, label: m.unit ? `${m.name} (${m.unit.name})` : m.name }))}
            units={(units ?? []).map((u) => ({ value: u.id as string, label: u.name as string }))} sites={siteChoices}
            materialName={(id) => material.get(id)?.name ?? ''} unitOf={unitOf}
            siteName={siteName} canRemove={(by) => office || by === profile.user_id} />
        ) },
        { key: 'used', label: t('stock.usedTab'), count: usedRows.length, panel: usedRows.length === 0 ? (
          <p className="card empty">{t('stock.noneUsed')}</p>
        ) : (
          <div className="card table-wrap flush">
            <table className="ledger statement">
              <thead>
                <tr>
                  <th>{t('stock.date')}</th>
                  <th>{t('stock.material')}</th>
                  <th>{t('stock.site')}</th>
                  <th className="num">{t('stock.usedQty')}</th>
                  <th className="num">{t('stock.rate')}</th>
                  <th className="num">{t('stock.amount')}</th>
                  <th>{t('stock.remark')}</th>
                </tr>
              </thead>
              <tbody>
                {usedRows.map((r) => {
                  const rate = rateOn(r);
                  return (
                    <tr key={r.id}>
                      <td className="nowrap">
                        <Link href={`/report?site=${r.site_id}&date=${r.use_date}`} className="underline">{showDate(r.use_date)}</Link>
                      </td>
                      <td>{material.get(r.material_id)?.name}</td>
                      <td>{siteName(r.site_id)}</td>
                      <td className="num">{qty(Number(r.quantity), r.material_id)}</td>
                      <td className="num">{rate === null ? <span className="muted">–</span> : showPaise(Math.round(rate))}</td>
                      <td className="num">{showPaise(valueOf(Number(r.quantity), rate))}</td>
                      <td>{r.remark}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) },
      ]} />
    </>
  );
}
