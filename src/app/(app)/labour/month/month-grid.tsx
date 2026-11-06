'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { toPaise } from '@/components/form';
import { salaryFor } from '@/lib/labour';
import { roundOffSmall, showPaise } from '@/lib/money';
import type { MonthState } from '../actions';

export interface GridRow {
  id: string;
  name: string;
  skill: string;
  rate: number;
  before: number;
  days: string;
  ot: string;
  advance: string;
  deduction: string;
  addition: string;
  paid: string;
  note: string;
}
type Field = 'days' | 'ot' | 'advance' | 'deduction' | 'addition' | 'paid' | 'note';

const RUPEES = '[₹,\\s\\d]*(\\.\\d{1,2})?';
const asNumber = (text: string) => Number(text) || 0;

/** The same figures whichever way they were typed: 2,000 is 2000. */
const figures = (r: Pick<GridRow, Field>) => JSON.stringify([
  asNumber(r.days), asNumber(r.ot), toPaise(r.advance), toPaise(r.deduction), toPaise(r.addition), toPaise(r.paid), r.note.trim(),
]);

function Money({ paise, tone }: { paise: number; tone?: 'plus' | 'minus' }) {
  return <td className={`num${paise === 0 ? ' muted' : tone ? ` strong ${tone}` : ''}`}>{paise === 0 ? '–' : showPaise(paise)}</td>;
}

/** One worker's month. Its figures work themselves out as they are typed; only a changed row is sent to be saved. */
function Row({ row }: { row: GridRow }) {
  const t = useTranslations('labour');
  const [typed, setTyped] = useState<Pick<GridRow, Field>>(row);
  const input = (field: Field, label: string) => ({
    name: `${row.id}:${field}`,
    'aria-label': `${row.name}: ${label}`,
    value: typed[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTyped({ ...typed, [field]: e.target.value }),
  });
  const rupees = (field: Field, label: string) => (
    <td className="num"><input {...input(field, label)} inputMode="decimal" pattern={RUPEES} title={t('errors.amount')} /></td>
  );
  const salary = salaryFor(asNumber(typed.days), asNumber(typed.ot), row.rate);
  const toPay = row.before + salary + toPaise(typed.addition) - toPaise(typed.deduction) - toPaise(typed.advance);
  const left = roundOffSmall(toPay - toPaise(typed.paid));

  return (
    <tr id={row.id} data-name={row.name} className={left < 0 ? 'extra-month' : undefined}>
      <td>
        <Link href={`/labour/${row.id}`} className="party-link">{row.name}</Link>
        {row.skill && <small className="muted">{row.skill}</small>}
        <input type="hidden" name={`${row.id}:name`} value={row.name} />
        {figures(typed) !== figures(row) && <input type="hidden" name="changed" value={row.id} />}
      </td>
      <Money paise={row.rate} />
      <td className="num"><input {...input('days', t('days'))} type="number" inputMode="decimal" min="0" max="100" step="0.01" title={t('errors.days')} /></td>
      <td className="num"><input {...input('ot', t('otHours'))} type="number" inputMode="decimal" min="0" max="999" step="0.01" title={t('errors.ot')} /></td>
      <Money paise={salary} />
      {rupees('advance', t('advance'))}
      {rupees('deduction', t('deduction'))}
      {rupees('addition', t('addition'))}
      <td><input {...input('note', t('reason'))} /></td>
      <td className={`num${row.before === 0 ? ' muted' : row.before < 0 ? ' plus' : ' minus'}`}>
        {row.before === 0 ? '–' : showPaise(row.before)}
        {row.before !== 0 && <span className="balance-word">{t(row.before < 0 ? 'beforeExtra' : 'beforeToPay')}</span>}
      </td>
      <Money paise={Math.max(toPay, 0)} />
      {rupees('paid', t('paid'))}
      <Money paise={Math.max(left, 0)} tone="minus" />
      <Money paise={Math.min(left, 0)} tone="plus" />
    </tr>
  );
}

/** The month's sheet, one row per worker. A save stays on the page, so a mistake loses nothing typed. */
export function MonthGrid({ rows, action }: { rows: GridRow[]; action: (state: MonthState, data: FormData) => Promise<MonthState> }) {
  const t = useTranslations('labour');
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="sheet-wrap month-grid">
      <div className="table-wrap">
        <table className="sheet" id="labour-month">
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th className="num">{t('rateShort')}</th>
              <th className="num">{t('days')}</th>
              <th className="num">{t('otHours')}</th>
              <th className="num">{t('salary')}</th>
              <th className="num">{t('advance')}</th>
              <th className="num">{t('deduction')}</th>
              <th className="num">{t('addition')}</th>
              <th>{t('reason')}</th>
              <th className="num">{t('before')}</th>
              <th className="num">{t('toPay')}</th>
              <th className="num">{t('paid')}</th>
              <th className="num">{t('remaining')}</th>
              <th className="num">{t('extra')}</th>
            </tr>
          </thead>
          <tbody>
            {/* A row starts again from what the server holds once its saved figures change. */}
            {rows.map((r) => <Row key={`${r.id}:${figures(r)}:${r.before}`} row={r} />)}
          </tbody>
        </table>
      </div>
      <div className="month-save">
        <button type="submit" className="btn" disabled={pending}>{t('save')}</button>
        {state.error && <p role="alert" className="error">{state.name && `${state.name}: `}{t(`errors.${state.error}`)}</p>}
        {!state.error && state.saved !== undefined && <p role="status" className="muted">{t('saved', { count: state.saved })}</p>}
      </div>
    </form>
  );
}
