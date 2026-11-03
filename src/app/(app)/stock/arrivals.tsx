import type { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { SearchSelect } from '@/components/search-select';
import { showPaise } from '@/lib/money';
import { QTY } from '@/lib/stock';
import { showDate, todayInIndia } from '../entries/data';
import { addArrival, removeArrival } from './actions';

/** One line of stock_in_rows or asset_in_rows. */
export interface ArrivalRow {
  id: string;
  site_id: string;
  entry_date: string;
  material_id: string;
  quantity: number | string;
  rate_paise: number | string | null;
  amount_paise: number | string | null;
  note: string;
  created_by: string;
}

type Choice = { value: string; label: string };

/**
 * What arrived at the sites, typed by the supervisors: the form to add a line, then the lines, newest first.
 * The Stock page lists consumables; the Assets page lists assets. `materials` are the ones this page takes.
 */
export function Arrivals({ page, rows, materials, sites, materialName, unitOf, siteName, canRemove, t }: {
  page: '/stock' | '/assets';
  rows: ArrivalRow[];
  materials: Choice[];
  sites: Choice[];
  materialName: (id: string) => string;
  unitOf: (id: string) => string;
  siteName: (id: string) => string;
  /** The office removes any line; a supervisor their own (the database also keeps it to the same day). */
  canRemove: (createdBy: string) => boolean;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const today = todayInIndia();
  const id = (name: string) => `${page.slice(1)}-in-${name}`;
  return (
    <>
      <form action={addArrival.bind(null, page)} className="card asset-move">
        <p className="bill-section">{t(`arrivals.title.${page.slice(1)}`)}</p>
        <div className="asset-move-grid">
          <div className="field wide">
            <label htmlFor={id('material')}>{t('arrivals.material')}</label>
            <SearchSelect id={id('material')} name="material_id" options={materials} required placeholder={t('common.choose')} />
          </div>
          <div className="field">
            <label htmlFor={id('qty')}>{t('arrivals.quantity')}</label>
            <input id={id('qty')} name="quantity" inputMode="decimal" autoComplete="off" required className="num" />
          </div>
          <div className="field">
            <label htmlFor={id('rate')}>{t('arrivals.rate')}<span className="optional"> {t('common.optional')}</span></label>
            <input id={id('rate')} name="rate" inputMode="decimal" autoComplete="off" className="num" />
          </div>
          <div className="field">
            <label htmlFor={id('site')}>{t('arrivals.site')}</label>
            <SearchSelect id={id('site')} name="site_id" options={sites} required placeholder={t('common.choose')}
              defaultValue={sites.length === 1 ? sites[0]!.value : ''} />
          </div>
          <div className="field">
            <label htmlFor={id('date')}>{t('arrivals.date')}</label>
            <input id={id('date')} type="date" name="in_date" defaultValue={today} max={today} required />
          </div>
          <div className="field wide">
            <label htmlFor={id('note')}>{t('arrivals.note')}<span className="optional"> {t('common.optional')}</span></label>
            <input id={id('note')} name="note" autoComplete="off" placeholder={t('arrivals.notePlaceholder')} />
          </div>
        </div>
        <p className="hint">{t('arrivals.hint')}</p>
        <button type="submit" className="btn"><Icon name="add" /> {t('arrivals.add')}</button>
      </form>
      {rows.length === 0 ? (
        <p className="card empty">{t('arrivals.none')}</p>
      ) : (
        <div className="card table-wrap flush">
          <table className="ledger">
            <thead>
              <tr>
                <th>{t('arrivals.date')}</th>
                <th>{t('arrivals.material')}</th>
                <th>{t('arrivals.site')}</th>
                <th className="num">{t('arrivals.quantity')}</th>
                <th className="num">{t('arrivals.rateShort')}</th>
                <th className="num">{t('arrivals.cost')}</th>
                <th>{t('arrivals.note')}</th>
                <th aria-label={t('arrivals.remove')} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{showDate(r.entry_date)}</td>
                  <td>{materialName(r.material_id)}</td>
                  <td>{siteName(r.site_id)}</td>
                  <td className="num">{`${QTY.format(Number(r.quantity))} ${unitOf(r.material_id)}`.trim()}</td>
                  <td className="num">{r.rate_paise === null ? <span className="muted">–</span> : showPaise(Number(r.rate_paise))}</td>
                  <td className="num">{r.amount_paise === null ? <span className="muted">–</span> : showPaise(Number(r.amount_paise))}</td>
                  <td>{r.note}</td>
                  <td>
                    {canRemove(r.created_by) && (
                      <form action={removeArrival.bind(null, page, r.id)}>
                        <button type="submit" className="btn ghost small icon-btn" aria-label={t('arrivals.remove')}>
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
  );
}
