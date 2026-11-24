import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { RowFilter } from '@/components/row-filter';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { chargeFor, placeMonth, supplied } from '@/lib/labour-supply';
import { percentOf, showPaise } from '@/lib/money';
import { getEntryForm } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { todayInIndia } from '../../entries/data';
import { loadChoices } from '../../masters/options';
import { MoneyCell, Stat } from '../../party/shared';
import { loadFirms } from '../../between/data';
import { pickMonth, showMonth } from '../data';
import { confirmSupplied, savePlaces } from './actions';
import { loadConfirmed, loadSupplied } from './data';
import { PlacesForm } from './places-form';

const ERRORS = new Set(['date', 'no_labour_firm', 'unplaced', 'need_both', 'not_saved']);

/**
 * Labour supplied in a month: where each worker's days were, what each place is charged for them, and (for the owner and
 * office) putting our own firms' part in both firms' books. A Labour login says where the days were and sees no charges.
 */
export default async function LabourSuppliedPage({ searchParams }: { searchParams: Promise<{ month?: string; error?: string; confirmed?: string }> }) {
  const profile = await requireProfile('owner', 'office', 'labour');
  const office = profile.role !== 'labour';
  const [t, asked] = await Promise.all([getTranslations(), searchParams]);
  const thisMonth = todayInIndia().slice(0, 7);
  const month = pickMonth(asked.month, thisMonth);
  const db = await createClient();
  const working = office ? await getWorkingFirm() : null;
  const [{ workers, places }, firms, confirmed, choices] = await Promise.all([
    loadSupplied(db, month),
    office ? loadFirms(db) : [],
    office ? loadConfirmed(db, month) : new Map(),
    office && working ? loadChoices(db, getEntryForm('client-bill')!.fields, { working, t }) : {} as Awaited<ReturnType<typeof loadChoices>>,
  ]);
  const { places: totals, unplaced } = supplied(workers, month);
  const supplier = firms.find((f) => f.runs_labour);
  const rows = workers.map((w) => ({
    id: w.id, name: w.name, skill: w.skill, days: w.days, ot: w.ot, charge: office ? chargeFor(w.charges, w.rates, month) : null,
    lines: placeMonth({ days: w.days, ot: w.ot }, w.said, w.usual).at.map((p) => ({ placeId: p.placeId, days: String(p.days), ot: p.ot ? String(p.ot) : '' })),
  }));
  // A place switched off is offered only where a worker is already there.
  const used = new Set(rows.flatMap((r) => r.lines.map((l) => l.placeId)));
  const offered = places.filter((p) => p.is_active || used.has(p.id));
  const shown = places.filter((p) => totals.has(p.id) || (p.firm_id && confirmed.has(`${p.firm_id}/${p.site_id}`)));
  const ours = shown.filter((p) => p.firm_id);
  const charged = [...totals.values()].reduce((s, x) => s + x.charged, 0);
  const paid = [...totals.values()].reduce((s, x) => s + x.paid, 0);
  const rateOf = (part: number, base: number) => (base > 0 && part > 0 ? String(Math.round((part * 10_000) / base)) : '');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('supplied.title')}</h1>
          <p className="lede">{t(office ? 'supplied.lede' : 'supplied.ledeLabour')}</p>
        </div>
        {office && <Link href="/labour/places" className="btn ghost">{t('supplied.places')}</Link>}
      </div>
      {asked.error && <p className="banner bad" role="alert">{ERRORS.has(asked.error) ? t(`supplied.errors.${asked.error}`) : asked.error}</p>}
      {asked.confirmed && <p className="banner" role="status">{t('supplied.done', { month: showMonth(month) })}</p>}
      {office && !supplier && <p className="banner bad"><span>{t('supplied.errors.no_labour_firm')} <Link href="/masters/firms" className="underline">{t('party.goSetup')}</Link></span></p>}

      {office && (
        <div className="stats">
          <Stat label={t('supplied.chargedIn', { month: showMonth(month) })} value={showPaise(charged)} />
          <Stat label={t('supplied.paidIn')} value={showPaise(paid)} />
          <Stat label={t(charged >= paid ? 'supplied.keeps' : 'supplied.loses')} value={showPaise(Math.abs(charged - paid))} tone={charged > paid ? 'done' : charged < paid ? 'owe' : undefined} />
        </div>
      )}

      <div className="toolbar">
        {rows.length > 0 && <RowFilter table="supplied" label={t('labour.search')} placeholder={t('labour.searchHint')} none={t('labour.searchNone')} />}
        <AutoForm action="/labour/supplied" className="date-filter">
          <label className="muted" htmlFor="supplied-month">{t('labour.month')}</label>
          <input key={month} id="supplied-month" type="month" name="month" defaultValue={month} max={thisMonth} required />
        </AutoForm>
      </div>

      {rows.length === 0 ? <p className="card empty-state">{t('supplied.none')}</p>
        : places.length === 0 ? <p className="card empty-state">{t(office ? 'supplied.noPlaces' : 'supplied.noPlacesLabour')} {office && <Link href="/labour/places" className="underline">{t('supplied.places')}</Link>}</p>
          : <PlacesForm key={`${month}${JSON.stringify(rows.map((r) => r.lines))}`} rows={rows} places={offered.map(({ id, name }) => ({ id, name }))} action={savePlaces.bind(null, month)} />}

      {office && shown.length > 0 && (
        <form action={confirmSupplied.bind(null, month)} className="ledger-section">
          <h2>{t('supplied.totalsTitle')}</h2>
          <p className="hint">{t('supplied.totalsHint')}</p>
          <div className="card table-wrap flush">
            <table className="ledger">
              <thead>
                <tr>
                  <th>{t('supplied.place')}</th><th className="num">{t('labour.days')}</th><th className="num">{t('labour.otHours')}</th>
                  <th className="num">{t('supplied.paidIn')}</th><th className="num">{t('supplied.charged')}</th>
                  <th>{t('fields.gst_rate')}</th><th>{t('fields.tds_rate')}</th><th>{t('supplied.books')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const x = totals.get(p.id) ?? { days: 0, ot: 0, charged: 0, paid: 0 };
                  const old = confirmed.get(`${p.firm_id}/${p.site_id}`);
                  const [gst, tds] = old ? [rateOf(old.gst, old.base), rateOf(old.tds, old.base)] : ['', ''];
                  const same = old && old.base === x.charged && old.gst === percentOf(x.charged, Number(gst || 0)) && old.tds === percentOf(x.charged, Number(tds || 0));
                  const rate = (name: string, value: string, options: { value: string; label: string }[]) => (
                    <select name={`${p.id}:${name}`} defaultValue={value} aria-label={`${t(`fields.${name}_rate`)} ${p.name}`}>
                      <option value="">{t('between.none')}</option>
                      {value && !options.some((o) => o.value === value) && <option value={value}>{Number(value) / 100}%</option>}
                      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  );
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td><td className="num">{x.days}</td><td className="num">{x.ot || '–'}</td>
                      <MoneyCell paise={x.paid} /><MoneyCell paise={x.charged} strong />
                      {p.firm_id ? (
                        <>
                          <td>{rate('gst', gst, choices.gstRates ?? [])}</td><td>{rate('tds', tds, choices.tdsRates ?? [])}</td>
                          <td>{!old ? <span className="pill unverified">{t('supplied.notYet')}</span>
                            : <><span className={`pill ${same ? 'cleared' : 'pending'}`}>{t(same ? 'supplied.inBooks' : 'supplied.changed', { amount: showPaise(old.base) })}</span>{' '}
                              <Link href={`/entries/${old.entryId}`} className="serial underline">{old.serial}</Link></>}</td>
                        </>
                      ) : <td colSpan={3} className="muted">{t('supplied.billClient')} <Link href={`/client?id=${p.client_id}`} className="underline">{t('supplied.openClient')}</Link></td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td>{t('bankbook.total')}</td><td /><td /><MoneyCell paise={paid} /><MoneyCell paise={charged} strong /><td colSpan={3} /></tr></tfoot>
            </table>
          </div>
          {unplaced.length > 0 && <p className="banner bad">{t('supplied.unplaced', { count: String(unplaced.length), names: workers.filter((w) => unplaced.includes(w.id)).slice(0, 5).map((w) => w.name).join(', ') })}</p>}
          {ours.length > 0 && supplier && <button type="submit" className="btn big" disabled={unplaced.length > 0}>{t('supplied.confirm', { month: showMonth(month) })}</button>}
        </form>
      )}
    </>
  );
}
