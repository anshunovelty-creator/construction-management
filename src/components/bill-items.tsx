'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { billTotals, priceItem, quantityToMilli, type PricedItem } from '@/lib/ledger/bill-items';
import { ITEM_INPUTS } from '@/lib/masters/parse';
import type { Choice } from '@/lib/masters/registry';
import { rupeesToPaise, showPaise } from '@/lib/money';
import { rupeesInWords } from '@/lib/words';
import { Icon } from '@/components/icons';
import { SearchSelect } from '@/components/search-select';

type Row = { key: number; material: string; qty: string; rate: string; gst: string };
type Typed = string | string[] | undefined;

const list = (v: Typed) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

/** The line as priced so far, or null while it is not complete. */
function priced(row: Row): PricedItem | null {
  try {
    const ratePaise = rupeesToPaise(row.rate);
    if (!row.material || ratePaise <= 0) return null;
    return priceItem({ materialId: row.material, quantityMilli: quantityToMilli(row.qty), ratePaise, gstBp: Number(row.gst) });
  } catch {
    return null;
  }
}

/**
 * A bill's lines, like a Tally invoice: item, quantity, rate and GST per line, worked out as they are typed,
 * with the amount before GST, the GST and the total underneath. Posts one value per line under ITEM_INPUTS.
 */
export function BillItems({
  materials,
  gstRates,
  values,
  errors = {},
  aside,
}: {
  materials: Choice[];
  gstRates: Choice[];
  /** What the user typed before the form came back with errors. */
  values: Record<string, Typed>;
  errors?: Record<string, string>;
  /** The bill's notes and deductions, shown beside the totals. */
  aside?: React.ReactNode;
}) {
  const t = useTranslations();
  const defaultGst = gstRates.find((r) => r.value === '1800')?.value ?? gstRates[0]?.value ?? '0';
  const [rows, setRows] = useState<Row[]>(() => {
    const typed = list(values[ITEM_INPUTS.material]).map((material, i) => ({
      key: i,
      material,
      qty: list(values[ITEM_INPUTS.quantity])[i] ?? '',
      rate: list(values[ITEM_INPUTS.rate])[i] ?? '',
      gst: list(values[ITEM_INPUTS.gst])[i] ?? defaultGst,
    }));
    return typed.length ? typed : [{ key: 0, material: '', qty: '', rate: '', gst: defaultGst }];
  });
  const set = (key: number, change: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));
  // A new line takes the GST rate of the line above: most bills charge one rate throughout.
  const add = () => setRows((rs) => [...rs, { key: Math.max(...rs.map((r) => r.key)) + 1, material: '', qty: '', rate: '', gst: rs.at(-1)?.gst ?? defaultGst }]);
  const remove = (key: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));

  const prices = rows.map(priced);
  const totals = billTotals(prices.filter((p): p is PricedItem => p !== null));
  const money = (paise: number | undefined) => (paise === undefined ? <span className="muted">–</span> : showPaise(paise));

  return (
    <div className="bill-items">
      <p className="bill-section">{t('items.title')}</p>
      {materials.length === 0 && <p className="hint">{t('party.noMaterials')}</p>}
      <div className="table-wrap">
        <table>
          <colgroup>
            <col className="c-no" />
            <col />
            <col className="c-qty" />
            <col className="c-rate" />
            <col className="c-amount" />
            <col className="c-gst" />
            <col className="c-gstamt" />
            <col className="c-total" />
            <col className="c-del" />
          </colgroup>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{t('items.item')}</th>
              <th className="num">{t('items.qty')}</th>
              <th className="num">{t('items.rate')}</th>
              <th className="num">{t('items.amount')}</th>
              <th>{t('items.gst')}</th>
              <th className="num">{t('items.gstAmount')}</th>
              <th className="num">{t('items.total')}</th>
              <th><span className="sr-only">{t('items.remove')}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const p = prices[i];
              const error = errors[`items.${i + 1}`];
              const label = (what: string) => `${t(`items.${what}`)} ${i + 1}`;
              return (
                <tr key={row.key} aria-invalid={error ? true : undefined}>
                  <td className="num muted">{i + 1}</td>
                  <td>
                    <SearchSelect name={ITEM_INPUTS.material} aria-label={label('item')} value={row.material}
                      placeholder={t('common.choose')} options={materials}
                      onChange={(v) => set(row.key, { material: v })} />
                    {error && <p className="error">{t(`errors.${error}`)}</p>}
                  </td>
                  <td className="num">
                    <input name={ITEM_INPUTS.quantity} aria-label={label('qty')} inputMode="decimal" autoComplete="off"
                      value={row.qty} onChange={(e) => set(row.key, { qty: e.target.value })} />
                  </td>
                  <td className="num">
                    <input name={ITEM_INPUTS.rate} aria-label={label('rate')} inputMode="decimal" autoComplete="off"
                      value={row.rate} onChange={(e) => set(row.key, { rate: e.target.value })} />
                  </td>
                  <td className="num">{money(p?.amountPaise)}</td>
                  <td>
                    <SearchSelect name={ITEM_INPUTS.gst} aria-label={label('gst')} value={row.gst} options={gstRates}
                      onChange={(v) => set(row.key, { gst: v })} />
                  </td>
                  <td className="num">{money(p?.gstPaise)}</td>
                  <td className="num"><b>{money(p ? p.amountPaise + p.gstPaise : undefined)}</b></td>
                  <td>
                    <button type="button" className="btn ghost small" aria-label={label('remove')}
                      disabled={rows.length === 1} onClick={() => remove(row.key)}><Icon name="close" size={16} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn ghost small add-line" onClick={add}>＋ {t('items.add')}</button>
      {errors.items && <p className="error">{t(`errors.${errors.items}`)}</p>}
      <div className="bill-foot">
        {aside}
        <div className="bill-sum">
          <dl className="bill-totals">
            <div><dt>{t('items.base')}</dt><dd>{showPaise(totals.base)}</dd></div>
            <div><dt>{t('items.gstTotal')}</dt><dd>{showPaise(totals.gst)}</dd></div>
            <div className="grand"><dt>{t('items.grand')}</dt><dd>{showPaise(totals.total)}</dd></div>
          </dl>
          {totals.total > 0 && <p className="amount-words">{rupeesInWords(totals.total)}</p>}
        </div>
      </div>
    </div>
  );
}
