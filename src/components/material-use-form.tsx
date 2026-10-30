'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { showPaise } from '@/lib/money';
import { QTY, valueOf } from '@/lib/stock';

export interface MaterialLine {
  materialId: string;
  quantity: string;
  remark: string;
}

/** What saving comes back with: when it was saved, or the mistake and the line it is on (from 0). */
export interface MaterialState {
  error?: string;
  line?: number;
  detail?: string;
  saved?: number;
}

/** A material as the form shows it: its unit, the site's average rate (paise per unit) and what is left there now. */
export interface MaterialChoice {
  id: string;
  name: string;
  unit: string;
  rate: number | null;
  left: number;
}

const emptyLine = (): MaterialLine => ({ materialId: '', quantity: '', remark: '' });
const NUMBER = /^(\d+(\.\d*)?|\.\d+)$/;

/**
 * The material used on a site's day. Each line shows the material's unit, its rate, the amount, and what will be left
 * at the site once this is used, as you type; below zero is shown in red (a party bill may not be entered yet).
 */
export function MaterialUseForm({
  materials,
  action,
}: {
  materials: MaterialChoice[];
  action: (state: MaterialState, data: FormData) => Promise<MaterialState>;
}) {
  const t = useTranslations('report');
  const [state, formAction, pending] = useActionState(action, {});
  const [lines, setLines] = useState<MaterialLine[]>([emptyLine(), emptyLine(), emptyLine()]);
  const material = new Map(materials.map((m) => [m.id, m]));

  useEffect(() => {
    if (state.saved) setLines([emptyLine(), emptyLine(), emptyLine()]);
  }, [state.saved]);

  const change = (l: number, patch: Partial<MaterialLine>) =>
    setLines((all) => all.map((x, i) => (i === l ? { ...x, ...patch } : x)));

  // What is left after each line: the stock now, less this line and the lines above it for the same material.
  const usedSoFar = new Map<string, number>();
  const preview = lines.map((line) => {
    const m = material.get(line.materialId);
    const qty = NUMBER.test(line.quantity.trim()) ? Number(line.quantity) : null;
    if (!m || qty === null) return { m, amount: null, left: null };
    const used = (usedSoFar.get(m.id) ?? 0) + qty;
    usedSoFar.set(m.id, used);
    return { m, amount: m.rate === null ? null : valueOf(qty, m.rate), left: Math.round((m.left - used) * 1000) / 1000 };
  });
  const total = preview.reduce((sum, p) => sum + (p.amount ?? 0), 0);

  return (
    <form action={formAction} className="card work-builder">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="work-builder-head">
        <h2>{t('use.addTitle')}</h2>
        <p className="hint">{t('use.addHint')}</p>
      </div>
      {state.error && (
        <p className="banner bad" role="alert">
          {state.line !== undefined && `${t('use.whereLine', { line: state.line + 1 })} `}
          {t(`errors.${state.error}`)} {state.detail}
        </p>
      )}

      <div className="activity">
        <div className="table-wrap">
          <table className="measure-table use-table">
            <thead>
              <tr>
                <th className="box">#</th>
                <th className="box">{t('use.material')}</th>
                <th className="box">{t('use.quantity')}</th>
                <th className="num">{t('use.rate')}</th>
                <th className="num">{t('use.amount')}</th>
                <th className="num">{t('use.leftAfter')}</th>
                <th>{t('use.remark')}</th>
                <th aria-label={t('use.removeLine')} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, l) => {
                const { m, amount, left } = preview[l]!;
                return (
                  <tr key={l} className={state.line === l ? 'wrong' : undefined}>
                    <td className="box muted line-no">{l + 1}</td>
                    <td className="box wide" data-label={t('use.material')}>
                      <select
                        value={line.materialId}
                        onChange={(e) => change(l, { materialId: e.target.value })}
                        aria-label={`${t('use.material')}, ${t('work.lineNo', { n: l + 1 })}`}
                      >
                        <option value="">{t('use.pickMaterial')}</option>
                        {materials.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </td>
                    <td className="box qty" data-label={t('use.quantity')}>
                      <span className="qty-with-unit">
                        <input
                          value={line.quantity}
                          onChange={(e) => change(l, { quantity: e.target.value })}
                          inputMode="decimal"
                          className="num"
                          aria-label={`${t('use.quantity')}, ${t('work.lineNo', { n: l + 1 })}`}
                        />
                        <span className="unit-tag">{m?.unit}</span>
                      </span>
                    </td>
                    <td className="num result" data-label={t('use.rate')}>{m?.rate == null ? '—' : showPaise(Math.round(m.rate))}</td>
                    <td className="num result" data-label={t('use.amount')}>{amount === null ? '—' : showPaise(amount)}</td>
                    <td data-label={t('use.leftAfter')} className={`num result${left !== null && left < 0 ? ' minus' : ''}`} title={left !== null && left < 0 ? t('use.belowZero') : undefined}>
                      {left === null ? (m ? `${QTY.format(m.left)} ${m.unit}` : '—') : `${QTY.format(left)} ${m!.unit}`}
                    </td>
                    <td className="wide" data-label={t('use.remark')}>
                      <input
                        value={line.remark}
                        onChange={(e) => change(l, { remark: e.target.value })}
                        className="remark-input"
                        placeholder={l === 0 ? t('use.remarkExample') : undefined}
                        aria-label={`${t('use.remark')}, ${t('work.lineNo', { n: l + 1 })}`}
                      />
                    </td>
                    <td className="line-remove">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="btn ghost small icon-btn"
                          onClick={() => setLines((all) => all.filter((_, i) => i !== l))}
                          aria-label={t('use.removeLine')}
                        >✕</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="activity-foot">
          <button type="button" className="btn ghost small" onClick={() => setLines((all) => [...all, emptyLine()])}>
            ＋ {t('use.addLine')}
          </button>
        </div>
      </div>

      <div className="work-total-bar">
        <span>{t('use.dayTotal')} <strong>{showPaise(total)}</strong></span>
        <button type="submit" className="btn" disabled={pending}>{pending ? t('saving') : t('use.save')}</button>
      </div>
    </form>
  );
}
