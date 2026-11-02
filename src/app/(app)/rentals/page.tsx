import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { RentalForm } from '@/components/rental-form';
import { Tabs } from '@/components/tabs';
import type { Field } from '@/lib/masters/registry';
import { requireProfile } from '@/lib/auth';
import { showPaise } from '@/lib/money';
import { rentDays, rentPaise } from '@/lib/rent';
import { QTY } from '@/lib/stock';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate, todayInIndia } from '../entries/data';
import { loadChoices } from '../masters/options';
import { Stat } from '../party/shared';
import { addRental, removeRental, updateRental } from './actions';

interface RentalRow {
  id: string;
  site_id: string;
  vendor_id: string | null;
  item: string;
  quantity: number | string;
  rate_paise: number | string;
  rented_on: string;
  returned_on: string | null;
  bill_no: string | null;
  created_by: string;
}

/** The lists the add form picks from. */
const FIELDS: Field[] = [
  { name: 'site_id', kind: 'ref', ref: 'sites', required: true },
  { name: 'rented_from', kind: 'ref', ref: 'vendors' },
];

/**
 * Things on rent at the sites (shuttering, bamboo, props): the meter runs at quantity × rate per day from the day
 * they came, and stops on the day they go back. The bill number shows which rent bill covers them.
 */
export default async function RentalsPage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  const profile = await requireProfile('owner', 'office', 'supervisor');
  const office = profile.role !== 'supervisor';
  const { tab = 'out', error } = await searchParams;
  const t = await getTranslations();
  const db = await createClient();
  const today = todayInIndia();
  const [{ data }, names, choices, { data: mySites }] = await Promise.all([
    db.from('rentals').select('id, site_id, vendor_id, item, quantity, rate_paise, rented_on, returned_on, bill_no, created_by')
      .order('rented_on', { ascending: false }).order('created_at', { ascending: false }).returns<RentalRow[]>(),
    loadNames(db),
    loadChoices(db, FIELDS),
    office ? Promise.resolve({ data: null }) : db.from('user_sites').select('site_id').eq('user_id', profile.user_id),
  ]);
  // Supervisors rent only for the sites given to them in People.
  const mine = mySites && new Set(mySites.map((s) => s.site_id as string));
  if (mine) choices.sites = (choices.sites ?? []).filter((c) => mine.has(c.value));

  const lines = (data ?? []).map((r) => {
    const days = rentDays(r.rented_on, r.returned_on ?? today);
    return { ...r, days, rent: rentPaise(Math.round(Number(r.quantity) * 1000), Number(r.rate_paise), days) };
  });
  const out = lines.filter((r) => !r.returned_on);
  const back = lines.filter((r) => r.returned_on);
  const total = (rows: typeof lines) => rows.reduce((sum, r) => sum + r.rent, 0);

  const table = (rows: typeof lines) => rows.length === 0 ? <p className="card empty">{t('rentals.none')}</p> : (
    <div className="card table-wrap flush">
      <table className="ledger">
        <thead>
          <tr>
            <th>{t('rentals.item')}</th>
            <th>{t('rentals.site')}</th>
            <th className="num">{t('rentals.qty')}</th>
            <th className="num">{t('rentals.rate')}</th>
            <th>{t('rentals.rentedOn')}</th>
            <th>{t('rentals.returnedOn')}</th>
            <th className="num">{t('rentals.days')}</th>
            <th className="num">{t('rentals.rent')}</th>
            <th>{t('rentals.bill')}</th>
            <th aria-label={t('rentals.update')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.item}
                {r.vendor_id && <><br /><span className="muted">{names.parties.get(r.vendor_id)}</span></>}
              </td>
              <td>{names.sites.get(r.site_id)}</td>
              <td className="num">{QTY.format(Number(r.quantity))}</td>
              <td className="num">{showPaise(Number(r.rate_paise))}</td>
              <td className="nowrap">{showDate(r.rented_on)}</td>
              <td className="nowrap">{r.returned_on ? showDate(r.returned_on) : <span className="muted">{t('rentals.onRent')}</span>}</td>
              <td className="num">{r.days}</td>
              <td className="num"><strong>{showPaise(r.rent)}</strong></td>
              <td>{r.bill_no ?? <span className="muted">–</span>}</td>
              <td>
                <details className="more rent-edit">
                  <summary className="btn ghost small">{r.returned_on ? t('rentals.update') : t('rentals.return')}</summary>
                  <form action={updateRental.bind(null, r.id)} className="more-menu card form">
                    <div className="field">
                      <label htmlFor={`ret-${r.id}`} className="font-medium">{t('rentals.returnedOn')}</label>
                      <input id={`ret-${r.id}`} type="date" name="returned_on" min={r.rented_on} max={today}
                        defaultValue={r.returned_on ?? today} />
                      <p className="hint">{t('rentals.clearHint')}</p>
                    </div>
                    <div className="field">
                      <label htmlFor={`bill-${r.id}`} className="font-medium">
                        {t('fields.bill_no')}<span className="optional"> {t('common.optional')}</span>
                      </label>
                      <input id={`bill-${r.id}`} name="bill_no" defaultValue={r.bill_no ?? ''} autoComplete="off" />
                    </div>
                    <button type="submit" className="btn">{t('rentals.save')}</button>
                  </form>
                </details>
                {(office || r.created_by === profile.user_id) && (
                  <form action={removeRental.bind(null, r.id)}>
                    <button type="submit" className="btn ghost small icon-btn" aria-label={t('rentals.remove', { item: r.item })}>
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
  );

  return (
    <>
      <h1>{t('rentals.title')}</h1>
      <p className="lede">{t('rentals.lede')}</p>
      {error && <p role="alert" className="error form-error">{t.has(`rentals.errors.${error}`) ? t(`rentals.errors.${error}`) : error}</p>}
      <div className="stats">
        <Stat label={t('rentals.runningNow')} value={showPaise(total(out))} note={t('rentals.linesOut', { count: out.length })} tone="owe" />
        <Stat label={t('rentals.returnedTotal')} value={showPaise(total(back))} />
        <Stat label={t('rentals.allTotal')} value={showPaise(total(lines))} />
      </div>
      <Tabs initial={tab} tabs={[
        { key: 'out', label: t('rentals.tabOut'), count: out.length, panel: table(out) },
        { key: 'back', label: t('rentals.tabBack'), count: back.length, panel: table(back) },
        { key: 'add', label: t('rentals.tabAdd'), panel: (
          <section className="card">
            <RentalForm action={addRental} sites={choices.sites ?? []} vendors={choices.vendors ?? []} today={today}
              items={[...new Set(lines.map((r) => r.item))].sort()} />
          </section>
        ) },
      ]} />
    </>
  );
}
