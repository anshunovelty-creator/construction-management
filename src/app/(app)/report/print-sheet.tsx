import { getTranslations } from 'next-intl/server';
import { showPaise } from '@/lib/money';
import { QTY } from '@/lib/stock';

export interface SheetData {
  firm: string | null;
  site: string;
  date: string;
  preparedBy: string;
  printedOn: string;
  work: { no: number; name: string; location: string | null; total: number;
    rows: { id: string; measurement: string; quantity: number; unit: string; rate: number; amount: number }[] }[];
  material: { id: string; name: string; quantity: number; unit: string; rate: number | null; amount: number; left: string; remark: string }[];
  labour: { id: string; name: string; staff: boolean; present: boolean; ot: number; dayPay: number; amount: number }[];
  other: { id: string; description: string; head: string; quantity: number; rate: number; amount: number }[];
  totals: { work: number; material: number; labour: number; staff: number; other: number; cost: number; profit: number };
}

/**
 * The daily report as a document, for the PDF a supervisor sends the owner: a letterhead, the day's figures, one ruled
 * table per section and lines to sign. Hidden on screen; it is the only thing printed from the report page.
 */
export async function PrintSheet({ d }: { d: SheetData }) {
  const t = await getTranslations('report');
  const present = d.labour.filter((l) => l.present).length;
  const nil = (cols: number) => <tr><td colSpan={cols} className="nil">{t('sheet.nil')}</td></tr>;

  return (
    <article className="print-only report-sheet">
      <header className="sheet-head">
        <div>
          {d.firm && <p className="sheet-firm">{d.firm}</p>}
          <h1>{t('sheet.title')}</h1>
        </div>
        <dl className="sheet-meta">
          <dt>{t('site')}</dt><dd>{d.site}</dd>
          <dt>{t('date')}</dt><dd>{d.date}</dd>
          <dt>{t('sheet.preparedBy')}</dt><dd>{d.preparedBy}</dd>
        </dl>
      </header>

      <div className="sheet-figures">
        <div><span>{t('workTotal')}</span><strong>{showPaise(d.totals.work)}</strong></div>
        <div><span>{t('costTotal')}</span><strong>{showPaise(d.totals.cost)}</strong></div>
        <div className={d.totals.profit < 0 ? 'minus' : 'plus'}><span>{t('profit')}</span><strong>{showPaise(d.totals.profit)}</strong></div>
        <div><span>{t('labourHeading')}</span><strong>{t('labour.marked', { p: present, a: d.labour.length - present })}</strong></div>
      </div>

      <h2>1. {t('workHeading')}</h2>
      <table className="sheet-table">
        <thead>
          <tr>
            <th className="n">{t('no')}</th><th>{t('activity')}</th><th>{t('measurement')}</th>
            <th className="num">{t('quantity')}</th><th className="num">{t('rate')}</th><th className="num">{t('amount')}</th>
          </tr>
        </thead>
        {d.work.length === 0 ? <tbody>{nil(6)}</tbody> : d.work.map((a) => (
          <tbody key={a.no}>
            {a.rows.map((r, i) => (
              <tr key={r.id}>
                <td className="n">{i === 0 && a.no}</td>
                <td>{i === 0 && <><strong>{a.name}</strong>{a.location && <span className="sub">{a.location}</span>}</>}</td>
                <td>{r.measurement}</td>
                <td className="num">{QTY.format(r.quantity)} {r.unit}</td>
                <td className="num">{showPaise(r.rate)}</td>
                <td className="num">{showPaise(r.amount)}</td>
              </tr>
            ))}
            {a.rows.length > 1 && (
              <tr className="sub-total"><td /><td colSpan={4}>{t('activityTotal', { name: a.name })}</td><td className="num">{showPaise(a.total)}</td></tr>
            )}
          </tbody>
        ))}
        <tfoot><tr><td /><td colSpan={4}>{t('workTotal')}</td><td className="num">{showPaise(d.totals.work)}</td></tr></tfoot>
      </table>

      <h2>2. {t('materialHeading')}</h2>
      <table className="sheet-table">
        <thead>
          <tr>
            <th className="n">{t('no')}</th><th>{t('material')}</th><th className="num">{t('used')}</th><th className="num">{t('rate')}</th>
            <th className="num">{t('amount')}</th><th className="num">{t('left')}</th><th>{t('remark')}</th>
          </tr>
        </thead>
        <tbody>
          {d.material.length === 0 ? nil(7) : d.material.map((r, i) => (
            <tr key={r.id}>
              <td className="n">{i + 1}</td><td><strong>{r.name}</strong></td>
              <td className="num">{QTY.format(r.quantity)} {r.unit}</td>
              <td className="num">{r.rate === null ? '—' : showPaise(Math.round(r.rate))}</td>
              <td className="num">{showPaise(r.amount)}</td><td className="num">{r.left}</td><td>{r.remark}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td /><td colSpan={3}>{t('sheet.total')}</td><td className="num">{showPaise(d.totals.material)}</td><td colSpan={2} /></tr></tfoot>
      </table>

      <h2>3. {t('labourHeading')}</h2>
      <table className="sheet-table">
        <thead>
          <tr>
            <th className="n">{t('no')}</th><th>{t('labour.name')}</th><th>{t('labour.attendance')}</th>
            <th className="num">{t('labour.ot')}</th><th className="num">{t('labour.dayPay')}</th><th className="num">{t('amount')}</th>
          </tr>
        </thead>
        <tbody>
          {d.labour.length === 0 ? nil(6) : d.labour.map((r, i) => (
            <tr key={r.id} className={r.present ? undefined : 'absent'}>
              <td className="n">{i + 1}</td>
              <td><strong>{r.name}</strong>{r.staff && <span className="tag">{t('labour.staff')}</span>}</td>
              <td>{t(`labour.mark.${r.present ? 'P' : 'A'}`)}</td>
              <td className="num">{r.ot > 0 ? t('labour.otHours', { n: r.ot }) : '—'}</td>
              <td className="num">{r.present ? showPaise(r.dayPay) : '—'}</td>
              <td className="num">{showPaise(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td /><td colSpan={4}>{t('labourTotal')}</td><td className="num">{showPaise(d.totals.labour)}</td></tr>
          <tr><td /><td colSpan={4}>{t('staffTotal')}</td><td className="num">{showPaise(d.totals.staff)}</td></tr>
        </tfoot>
      </table>

      <h2>4. {t('otherHeading')}</h2>
      <table className="sheet-table">
        <thead>
          <tr>
            <th className="n">{t('no')}</th><th>{t('other.description')}</th><th>{t('other.head')}</th>
            <th className="num">{t('other.quantity')}</th><th className="num">{t('rate')}</th><th className="num">{t('amount')}</th>
          </tr>
        </thead>
        <tbody>
          {d.other.length === 0 ? nil(6) : d.other.map((r, i) => (
            <tr key={r.id}>
              <td className="n">{i + 1}</td><td><strong>{r.description}</strong></td><td>{r.head}</td>
              <td className="num">{QTY.format(r.quantity)}</td><td className="num">{showPaise(r.rate)}</td><td className="num">{showPaise(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td /><td colSpan={4}>{t('sheet.total')}</td><td className="num">{showPaise(d.totals.other)}</td></tr></tfoot>
      </table>

      <h2>5. {t('profitHeading')}</h2>
      <table className="sheet-table sheet-summary">
        <tbody>
          <tr><td><strong>{t('workTotal')}</strong></td><td className="num"><strong>{showPaise(d.totals.work)}</strong></td></tr>
          <tr><td>{t('less', { what: t('materialHeading') })}</td><td className="num">{showPaise(d.totals.material)}</td></tr>
          <tr><td>{t('less', { what: t('labourTotal') })}</td><td className="num">{showPaise(d.totals.labour)}</td></tr>
          <tr><td>{t('less', { what: t('staffTotal') })}</td><td className="num">{showPaise(d.totals.staff)}</td></tr>
          <tr><td>{t('less', { what: t('otherHeading') })}</td><td className="num">{showPaise(d.totals.other)}</td></tr>
        </tbody>
        <tfoot>
          <tr className={d.totals.profit < 0 ? 'minus' : 'plus'}><td>{t('profit')}</td><td className="num">{showPaise(d.totals.profit)}</td></tr>
        </tfoot>
      </table>

      <footer className="sheet-sign">
        <div><span>{d.preparedBy}</span>{t('sheet.supervisorSign')}</div>
        <div><span /> {t('sheet.checkedSign')}</div>
      </footer>
      <p className="sheet-printed">{t('sheet.printedOn', { when: d.printedOn })}</p>
    </article>
  );
}
