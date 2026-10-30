'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { rupeesToPaise, showPaise } from '@/lib/money';
import { QTY } from '@/lib/stock';
import { amountPaise, DIMENSIONS, quantityMilli, type MeasurementLine, type Measure } from '@/lib/work';

export interface WorkActivity {
  description: string;
  unitId: string;
  rate: string;
  lines: MeasurementLine[];
}

/** What saving comes back with: when it was saved, or the mistake and where it is (activity and line, from 0). */
export interface WorkState {
  error?: string;
  activity?: number;
  line?: number;
  detail?: string;
  saved?: number;
}

export interface UnitChoice {
  id: string;
  name: string;
  measure: Measure;
}

const emptyLine = (): MeasurementLine => ({ count: '', length: '', width: '', height: '', quantity: '' });
const emptyActivity = (): WorkActivity => ({ description: '', unitId: '', rate: '', lines: [emptyLine()] });

/** The line's quantity in thousandths, or null while its boxes are not all filled in. */
function previewMilli(measure: Measure | undefined, line: MeasurementLine): number | null {
  if (!measure) return null;
  try {
    return quantityMilli(measure, line);
  } catch {
    return null;
  }
}

function previewRate(rate: string): number | null {
  try {
    const paise = rupeesToPaise(rate.trim() || '0');
    return paise >= 0 ? paise : null;
  } catch {
    return null;
  }
}

/**
 * The work done on a site's day, typed like the site's measurement book: each activity has a description, a unit
 * and a rate, then one or more measurements. The boxes follow the unit: M3 asks length × width × height, M2 length ×
 * width, Nos just the quantity. Quantities, amounts and the day's total are worked out as you type.
 */
export function WorkDoneForm({
  units,
  action,
}: {
  units: UnitChoice[];
  action: (state: WorkState, data: FormData) => Promise<WorkState>;
}) {
  const t = useTranslations('report');
  const [state, formAction, pending] = useActionState(action, {});
  const [activities, setActivities] = useState<WorkActivity[]>([emptyActivity()]);
  const unit = new Map(units.map((u) => [u.id, u]));

  // Saved: start a fresh sheet for the next entry.
  useEffect(() => {
    if (state.saved) setActivities([emptyActivity()]);
  }, [state.saved]);

  const change = (a: number, patch: Partial<WorkActivity>) =>
    setActivities((all) => all.map((x, i) => (i === a ? { ...x, ...patch } : x)));
  const changeLine = (a: number, l: number, box: keyof MeasurementLine, value: string) =>
    setActivities((all) => all.map((x, i) =>
      (i === a ? { ...x, lines: x.lines.map((line, j) => (j === l ? { ...line, [box]: value } : line)) } : x)));

  const totals = activities.map((activity) => {
    const measure = unit.get(activity.unitId)?.measure;
    const rate = previewRate(activity.rate);
    const lines = activity.lines.map((line) => {
      const milli = previewMilli(measure, line);
      return { milli, amount: milli !== null && rate !== null ? amountPaise(milli, rate) : null };
    });
    return { lines, amount: lines.reduce((sum, l) => sum + (l.amount ?? 0), 0) };
  });
  const dayTotal = totals.reduce((sum, a) => sum + a.amount, 0);
  const where = state.activity !== undefined
    ? state.line !== undefined
      ? t('work.whereLine', { activity: state.activity + 1, line: state.line + 1 })
      : t('work.whereActivity', { activity: state.activity + 1 })
    : '';

  return (
    <form action={formAction} className="card work-builder">
      <input type="hidden" name="work" value={JSON.stringify(activities)} />
      <div className="work-builder-head">
        <h2>{t('work.addTitle')}</h2>
        <p className="hint">{t('work.addHint')}</p>
      </div>
      {state.error && (
        <p className="banner bad" role="alert">{where} {t(`errors.${state.error}`)} {state.detail}</p>
      )}

      {activities.map((activity, a) => {
        const measure = unit.get(activity.unitId)?.measure;
        const boxes = measure ? (['count', ...DIMENSIONS[measure]] as const) : [];
        const wrong = state.activity === a;
        return (
          <section key={a} className={`activity${wrong ? ' wrong' : ''}`} aria-label={t('work.activityNo', { n: a + 1 })}>
            <div className="activity-head">
              <span className="sr-badge" aria-hidden="true">{a + 1}</span>
              <label className="activity-field grow">
                <span>{t('work.description')}</span>
                <input
                  value={activity.description}
                  onChange={(e) => change(a, { description: e.target.value })}
                  placeholder={t('work.descriptionExample')}
                />
              </label>
              <label className="activity-field">
                <span>{t('work.unit')}</span>
                <select value={activity.unitId} onChange={(e) => change(a, { unitId: e.target.value })}>
                  <option value="">{t('work.pickUnit')}</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <label className="activity-field">
                <span>{t('work.rate')}</span>
                <input
                  value={activity.rate}
                  onChange={(e) => change(a, { rate: e.target.value })}
                  inputMode="decimal"
                  className="num"
                  placeholder="0"
                />
              </label>
              {activities.length > 1 && (
                <button
                  type="button"
                  className="btn ghost small icon-btn"
                  onClick={() => setActivities((all) => all.filter((_, i) => i !== a))}
                  aria-label={t('work.removeActivity', { n: a + 1 })}
                >✕</button>
              )}
            </div>

            {!measure ? (
              <p className="activity-empty">{t('work.unitFirst')}</p>
            ) : (
              <div className="table-wrap">
                <table className="measure-table">
                  <thead>
                    <tr>
                      {boxes.map((box) => <th key={box} className="box">{t(`work.box.${box}`)}</th>)}
                      <th className="num">{t('work.quantity', { unit: unit.get(activity.unitId)!.name })}</th>
                      <th className="num">{t('work.amount')}</th>
                      <th aria-label={t('work.removeLine')} />
                    </tr>
                  </thead>
                  <tbody>
                    {activity.lines.map((line, l) => {
                      const { milli, amount } = totals[a]!.lines[l]!;
                      return (
                        <tr key={l} className={wrong && state.line === l ? 'wrong' : undefined}>
                          {boxes.map((box, b) => (
                            <td key={box} className="box" data-label={t(`work.box.${box}`)}>
                              {b > 0 && <span className="times" aria-hidden="true">×</span>}
                              <input
                                value={line[box] ?? ''}
                                onChange={(e) => changeLine(a, l, box, e.target.value)}
                                inputMode="decimal"
                                className="num"
                                placeholder={box === 'count' ? '1' : ''}
                                aria-label={`${t(`work.box.${box}`)}, ${t('work.lineNo', { n: l + 1 })}`}
                              />
                            </td>
                          ))}
                          <td className="num result" data-label={t('work.quantity', { unit: unit.get(activity.unitId)!.name })}>
                            {milli === null ? '—' : QTY.format(milli / 1000)}
                          </td>
                          <td className="num result" data-label={t('work.amount')}>{amount === null ? '—' : showPaise(amount)}</td>
                          <td className="line-remove">
                            {activity.lines.length > 1 && (
                              <button
                                type="button"
                                className="btn ghost small icon-btn"
                                onClick={() => change(a, { lines: activity.lines.filter((_, i) => i !== l) })}
                                aria-label={t('work.removeLine')}
                              >✕</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="activity-foot">
              <button
                type="button"
                className="btn ghost small"
                disabled={!measure}
                onClick={() => change(a, { lines: [...activity.lines, emptyLine()] })}
              >＋ {t('work.addLine')}</button>
              <span className="activity-total">
                {t('work.activityTotal')} <strong>{showPaise(totals[a]!.amount)}</strong>
              </span>
            </div>
          </section>
        );
      })}

      <button type="button" className="btn ghost add-activity" onClick={() => setActivities((all) => [...all, emptyActivity()])}>
        ＋ {t('work.addActivity')}
      </button>

      <div className="work-total-bar">
        <span>{t('work.dayTotal')} <strong>{showPaise(dayTotal)}</strong></span>
        <button type="submit" className="btn" disabled={pending}>{pending ? t('saving') : t('work.save')}</button>
      </div>
    </form>
  );
}
