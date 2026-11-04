'use client';

import { useTranslations } from 'next-intl';
import { Fragment, useActionState, useEffect, useState } from 'react';
import { rupeesToPaise, showPaise } from '@/lib/money';
import { QTY, valueOf } from '@/lib/stock';
import { Icon } from '@/components/icons';
import { NewMaterial } from '@/components/new-material';
import { SearchSelect } from '@/components/search-select';
import type { Choice } from '@/lib/masters/registry';

export interface MaterialLine {
  materialId: string;
  quantity: string;
  /** Rupees per unit; filled with the site's average rate, which the supervisor may change. Empty: the average. */
  rate: string;
  remark: string;
  /** The combination work this line is grouped under (PCC, RCC…). Empty: a material on its own. */
  mix?: string;
  /** For a line added from a combination work: how much 1 unit of the work takes, shown as a guide. */
  guide?: string;
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

/** A combination work from Setup (PCC, RCC…): its unit and how much of each material 1 unit takes. */
export interface MixChoice {
  id: string;
  name: string;
  unit: string;
  items: { materialId: string; quantity: number }[];
}

const emptyLine = (): MaterialLine => ({ materialId: '', quantity: '', rate: '', remark: '' });
const isEmpty = (x: MaterialLine) => !x.materialId && !x.quantity.trim() && !x.remark.trim();
/** The site's average rate as rupees to type over, e.g. 35000 paise -> "350". */
const rateText = (m: MaterialChoice | undefined) => (m?.rate == null ? '' : String(Math.round(m.rate) / 100));
const paiseOf = (text: string) => {
  try {
    const paise = rupeesToPaise(text);
    return paise >= 0 ? paise : null;
  } catch {
    return null;
  }
};
const NUMBER = /^(\d+(\.\d*)?|\.\d+)$/;

/**
 * The material used on a site's day. Each line shows the material's unit, its rate, the amount, and what will be left
 * at the site once this is used, as you type; below zero is shown in red (a party bill may not be entered yet).
 */
export function MaterialUseForm({
  materials: given,
  mixes,
  units,
  action,
}: {
  materials: MaterialChoice[];
  /** Picking one adds its materials as lines. */
  mixes: MixChoice[];
  /** For a material added here: its unit. */
  units: Choice[];
  action: (state: MaterialState, data: FormData) => Promise<MaterialState>;
}) {
  const t = useTranslations('report');
  const tNew = useTranslations('newMaterial');
  const [state, formAction, pending] = useActionState(action, {});
  const [lines, setLines] = useState<MaterialLine[]>([emptyLine(), emptyLine(), emptyLine()]);
  // Materials added from this form: none of this site's stock yet, so no rate and nothing left.
  const [added, setAdded] = useState<MaterialChoice[]>([]);
  const [creating, setCreating] = useState<{ line: number; name: string } | null>(null);
  const [mixPick, setMixPick] = useState(0);
  const materials = [...given, ...added];
  const material = new Map(materials.map((m) => [m.id, m]));

  useEffect(() => {
    if (state.saved) setLines([emptyLine(), emptyLine(), emptyLine()]);
  }, [state.saved]);

  const change = (l: number, patch: Partial<MaterialLine>) =>
    setLines((all) => all.map((x, i) => (i === l ? { ...x, ...patch } : x)));

  // A combination work becomes a group with a line for each of its materials, above the materials on their own; the
  // quantities are typed by hand. A work already in the form is not added twice.
  const addMix = (id: string) => {
    const mix = mixes.find((x) => x.id === id);
    setMixPick((n) => n + 1);
    if (!mix) return;
    const already = lines.findIndex((x) => x.mix === mix.name);
    if (already >= 0) {
      document.getElementById(`use-qty-${already}`)?.focus();
      return;
    }
    const kept = lines.filter((x) => !isEmpty(x));
    const grouped = kept.filter((x) => x.mix);
    setLines([...grouped, ...mix.items.map((item) => {
      const m = material.get(item.materialId);
      return { ...emptyLine(), materialId: item.materialId, rate: rateText(m), mix: mix.name,
        guide: t('use.mixGuide', { qty: `${QTY.format(item.quantity)} ${m?.unit ?? ''}`.trim(), unit: mix.unit || t('use.mixUnit') }) };
    }), ...kept.filter((x) => !x.mix)]);
    requestAnimationFrame(() => document.getElementById(`use-qty-${grouped.length}`)?.focus());
  };

  // One more material inside a work's group, below its last line.
  const addToMix = (name: string) => setLines((all) => {
    const at = all.map((x) => x.mix).lastIndexOf(name) + 1;
    return [...all.slice(0, at), { ...emptyLine(), mix: name }, ...all.slice(at)];
  });
  const removeMix = (name: string) => setLines((all) => {
    const rest = all.filter((x) => x.mix !== name);
    return rest.length > 0 ? rest : [emptyLine()];
  });

  // What is left after each line: the stock now, less this line and the lines above it for the same material.
  const usedSoFar = new Map<string, number>();
  const preview = lines.map((line) => {
    const m = material.get(line.materialId);
    const qty = NUMBER.test(line.quantity.trim()) ? Number(line.quantity) : null;
    if (!m || qty === null) return { m, amount: null, left: null };
    const used = (usedSoFar.get(m.id) ?? 0) + qty;
    usedSoFar.set(m.id, used);
    const rate = line.rate.trim() ? paiseOf(line.rate) : m.rate;
    return { m, amount: rate === null ? null : valueOf(qty, rate), left: Math.round((m.left - used) * 1000) / 1000 };
  });
  const total = preview.reduce((sum, p) => sum + (p.amount ?? 0), 0);

  return (
    <form action={formAction} className="card work-builder">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      {creating && (
        <NewMaterial name={creating.name} units={units} onClose={() => setCreating(null)} onAdded={(m) => {
          setAdded((all) => [...all, { id: m.id, name: m.name, unit: units.find((u) => u.value === m.unitId)?.label ?? '', rate: null, left: 0 }]);
          change(creating.line, { materialId: m.id });
          setCreating(null);
        }} />
      )}
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
                <th className="box">{t('use.rate')}</th>
                <th className="num">{t('use.amount')}</th>
                <th className="num">{t('use.leftAfter')}</th>
                <th>{t('use.remark')}</th>
                <th aria-label={t('use.removeLine')} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, l) => {
                const { m, amount, left } = preview[l]!;
                // A heading wherever the group changes: the work's name, or "Other materials" below the works.
                const heading = line.mix !== lines[l - 1]?.mix;
                return (
                  <Fragment key={l}>
                  {heading && (
                    <tr className="use-group">
                      <td colSpan={8}>
                        <div className="use-group-head">
                          <strong>{line.mix ?? t('otherMaterials')}</strong>
                          <span className="activity-total">
                            <strong>{showPaise(preview.reduce((sum, p, i) => sum + (lines[i]!.mix === line.mix ? p.amount ?? 0 : 0), 0))}</strong>
                          </span>
                          {line.mix && (
                            <>
                              <button type="button" className="btn ghost small" onClick={() => addToMix(line.mix!)}
                                aria-label={t('use.addToMix', { name: line.mix })}>＋ {t('use.addLine')}</button>
                              <button type="button" className="btn ghost small icon-btn" onClick={() => removeMix(line.mix!)}
                                aria-label={t('use.removeMix', { name: line.mix })}><Icon name="close" size={16} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr className={[state.line === l && 'wrong', line.mix && 'in-group'].filter(Boolean).join(' ') || undefined}>
                    <td className="box muted line-no">{l + 1}</td>
                    <td className="box wide" data-label={t('use.material')}>
                      <SearchSelect
                        value={line.materialId}
                        onChange={(v) => {
                          change(l, { materialId: v, rate: rateText(material.get(v)) });
                          // Picked: the quantity is next, so the cursor goes there.
                          if (v) requestAnimationFrame(() => document.getElementById(`use-qty-${l}`)?.focus());
                        }}
                        aria-label={`${t('use.material')}, ${t('work.lineNo', { n: l + 1 })}`}
                        placeholder={t('use.pickMaterial')}
                        // Each material says what is left at this site, so the right one is easy to pick.
                        options={materials.map((x) => ({ value: x.id, label: x.name, group: t('use.leftInList', { left: `${QTY.format(x.left)} ${x.unit}`.trim() }) }))}
                        onCreate={(name) => setCreating({ line: l, name })}
                        createLabel={(name) => tNew('addAs', { name })}
                      />
                    </td>
                    <td className="box qty" data-label={t('use.quantity')}>
                      <span className="qty-with-unit">
                        <input
                          id={`use-qty-${l}`}
                          value={line.quantity}
                          onChange={(e) => change(l, { quantity: e.target.value })}
                          inputMode="decimal"
                          className="num"
                          aria-label={`${t('use.quantity')}, ${t('work.lineNo', { n: l + 1 })}`}
                        />
                        <span className="unit-tag">{m?.unit}</span>
                      </span>
                      {line.guide && <span className="line-guide">{line.guide}</span>}
                    </td>
                    <td className="box rate" data-label={t('use.rate')}>
                      <input
                        value={line.rate}
                        onChange={(e) => change(l, { rate: e.target.value })}
                        inputMode="decimal"
                        className="num"
                        placeholder="—"
                        aria-label={`${t('use.rate')}, ${t('work.lineNo', { n: l + 1 })}`}
                      />
                    </td>
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
                        ><Icon name="close" size={16} /></button>
                      )}
                    </td>
                  </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="activity-foot">
          <button type="button" className="btn ghost small" onClick={() => setLines((all) => [...all, emptyLine()])}>
            ＋ {lines.some((x) => x.mix) ? t('use.addOther') : t('use.addLine')}
          </button>
          {mixes.length > 0 && (
            <span className="mix-pick">
              <SearchSelect key={mixPick} value="" onChange={addMix} placeholder={t('use.pickMix')} aria-label={t('use.pickMix')}
                options={mixes.map((x) => ({ value: x.id, label: x.name }))} />
            </span>
          )}
        </div>
      </div>

      <div className="work-total-bar">
        <span>{t('use.dayTotal')} <strong>{showPaise(total)}</strong></span>
        <button type="submit" className="btn" disabled={pending}>{pending ? t('saving') : t('use.save')}</button>
      </div>
    </form>
  );
}
