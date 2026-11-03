'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Icon } from '@/components/icons';
import { SearchSelect } from '@/components/search-select';
import type { Choice } from '@/lib/masters/registry';

export interface MixLine { materialId: string; quantity: string }
export interface MixState { error?: string; line?: number; detail?: string }
export interface MixMaterial { id: string; name: string; unit: string }

const empty = (): MixLine => ({ materialId: '', quantity: '' });

/**
 * A combination work and what 1 unit of it takes: e.g. 1 M3 of PCC takes 6.3 Bags of cement, 0.44 M3 of sand…
 * Used to add new works (no `initial`) and to change one.
 */
export function MixForm({ units, materials, initial, action }: {
  units: Choice[];
  materials: MixMaterial[];
  initial?: { name: string; unitId: string; isActive: boolean; lines: MixLine[] };
  action: (state: MixState, data: FormData) => Promise<MixState>;
}) {
  const t = useTranslations('mixes');
  const [state, formAction, pending] = useActionState(action, {});
  const [lines, setLines] = useState<MixLine[]>(initial?.lines ?? [empty(), empty(), empty(), empty()]);
  const [unitId, setUnitId] = useState(initial?.unitId ?? '');
  const unit = units.find((u) => u.value === unitId)?.label ?? t('unitOfWork');
  const material = new Map(materials.map((m) => [m.id, m]));
  const options = materials.map((m) => ({ value: m.id, label: m.unit ? `${m.name} (${m.unit})` : m.name }));
  const change = (l: number, patch: Partial<MixLine>) => setLines((all) => all.map((x, i) => (i === l ? { ...x, ...patch } : x)));

  return (
    <form action={formAction} className="work-builder mt-6">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="work-builder-head">
        <h2>{initial ? t('editTitle') : t('addTitle')}</h2>
        <p className="hint">{t('hint')}</p>
      </div>
      {state.error && (
        <p className="banner bad" role="alert">
          {state.line !== undefined && `${t('line', { line: state.line + 1 })} `}{t(`errors.${state.error}`)} {state.detail}
        </p>
      )}
      <div className="asset-move-grid">
        <div className="field wide">
          <label htmlFor="mix-name">{t('name')}</label>
          <input id="mix-name" name="name" defaultValue={initial?.name} required autoComplete="off" placeholder={t('nameExample')} />
        </div>
        <div className="field">
          <label htmlFor="mix-unit">{t('unit')}</label>
          <SearchSelect id="mix-unit" name="unit_id" options={units} value={unitId} onChange={setUnitId} placeholder={t('pickUnit')} />
        </div>
        {initial && (
          <label className="field flex items-center gap-2 self-end">
            <input type="checkbox" name="is_active" defaultChecked={initial.isActive} /> {t('active')}
          </label>
        )}
      </div>
      <div className="table-wrap">
        <table className="measure-table use-table">
          <thead>
            <tr>
              <th className="box">#</th>
              <th className="box">{t('material')}</th>
              <th className="box">{t('perUnit', { unit })}</th>
              <th aria-label={t('removeLine')} />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, l) => (
              <tr key={l} className={state.line === l ? 'wrong' : undefined}>
                <td className="box muted line-no">{l + 1}</td>
                <td className="box wide" data-label={t('material')}>
                  <SearchSelect value={line.materialId} options={options} placeholder={t('pickMaterial')}
                    aria-label={`${t('material')} ${l + 1}`}
                    onChange={(v) => {
                      change(l, { materialId: v });
                      if (v) requestAnimationFrame(() => document.getElementById(`mix-qty-${l}`)?.focus());
                    }} />
                </td>
                <td className="box qty" data-label={t('perUnit', { unit })}>
                  <span className="qty-with-unit">
                    <input id={`mix-qty-${l}`} value={line.quantity} onChange={(e) => change(l, { quantity: e.target.value })}
                      inputMode="decimal" className="num" aria-label={`${t('perUnit', { unit })} ${l + 1}`} />
                    <span className="unit-tag">{material.get(line.materialId)?.unit}</span>
                  </span>
                </td>
                <td className="line-remove">
                  {lines.length > 1 && (
                    <button type="button" className="btn ghost small icon-btn" aria-label={t('removeLine')}
                      onClick={() => setLines((all) => all.filter((_, i) => i !== l))}><Icon name="close" size={16} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="activity-foot">
        <button type="button" className="btn ghost small" onClick={() => setLines((all) => [...all, empty()])}>＋ {t('addLine')}</button>
      </div>
      <div className="work-total-bar">
        {initial ? <Link href="/masters/mixes" className="btn ghost">{t('cancel')}</Link> : <span />}
        <button type="submit" className="btn" disabled={pending}>{pending ? t('saving') : t('save')}</button>
      </div>
    </form>
  );
}
