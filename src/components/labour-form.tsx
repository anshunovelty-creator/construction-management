'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { quantityToMilli } from '@/lib/ledger/bill-items';
import { COST_HEADS } from '@/lib/ledger/types';
import { rupeesToPaise, showPaise } from '@/lib/money';
import { dayAmount, dayPay, otCenti, type PersonKind } from '@/lib/wages';
import { amountPaise } from '@/lib/work';
import { Icon } from '@/components/icons';
import { SearchSelect } from '@/components/search-select';

/** What saving comes back with: when it was saved, or the mistake and the line it is on (from 0). */
export interface LineState {
  error?: string;
  line?: number;
  detail?: string;
  saved?: number;
}

export interface LabourLine {
  partyId: string;
  /** P present, A absent, empty not marked yet. */
  mark: 'P' | 'A' | '';
  /** Overtime hours past the 8-hour day, for those present. */
  ot: string;
}

export interface OtherLine {
  description: string;
  costHead: string;
  quantity: string;
  rate: string;
}

/** A worker or staff member not yet marked for the day, with their rate from Setup (paise: per hour or per day). */
export interface Person {
  id: string;
  name: string;
  kind: PersonKind;
  rate: number | null;
}

type Action = (state: LineState, data: FormData) => Promise<LineState>;

const HEADS = COST_HEADS.filter((h) => h !== 'material');

/** quantity × rate as typed, or null while either is not a number yet. */
function preview(quantity: string, rate: string): number | null {
  try {
    return amountPaise(quantityToMilli(quantity.trim()), rupeesToPaise(rate.trim() || '0'));
  } catch {
    return null;
  }
}

function Problem({ state, t }: { state: LineState; t: ReturnType<typeof useTranslations> }) {
  if (!state.error) return null;
  return (
    <p className="banner bad" role="alert">
      {state.line !== undefined && `${t('use.whereLine', { line: state.line + 1 })} `}
      {t(`errors.${state.error}`)} {state.detail}
    </p>
  );
}

/** The day's amount as marked, or null while unmarked, without a rate, or with OT that is not a number yet. */
function pay(p: Person, line: LabourLine): number | null {
  if (!line.mark || (line.mark === 'P' && p.rate === null)) return null;
  try {
    return dayAmount(line.mark === 'P', line.mark === 'P' ? otCenti(line.ot) : 0, dayPay(p.kind, p.rate ?? 0));
  } catch {
    return null;
  }
}

/**
 * Who came today: staff first, then workers, like the site sheet. Tap P or A for each, and type OT hours past the
 * 8-hour day for those present. The pay comes from the rate in Setup. People left unmarked are not saved.
 */
export function LabourForm({ people, action }: { people: Person[]; action: Action }) {
  const t = useTranslations('report');
  const [state, formAction, pending] = useActionState(action, {});
  const [lines, setLines] = useState(() => people.map((p): LabourLine => ({ partyId: p.id, mark: '', ot: '' })));

  const change = (l: number, patch: Partial<LabourLine>) => setLines((all) => all.map((x, i) => (i === l ? { ...x, ...patch } : x)));
  const amounts = people.map((p, l) => pay(p, lines[l]!));
  const total = amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  const count = (mark: 'P' | 'A') => lines.filter((x) => x.mark === mark).length;

  return (
    <form action={formAction} className="card work-builder">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="work-builder-head">
        <h2>{t('labour.addTitle')}</h2>
        <p className="hint">{t('labour.addHint')}</p>
        <button type="button" className="btn ghost small" onClick={() => setLines((all) => all.map((x) => (x.mark ? x : { ...x, mark: 'P' })))}>
          {t('labour.allPresent')}
        </button>
      </div>
      <Problem state={state} t={t} />

      <div className="activity">
        <div className="table-wrap">
          <table className="measure-table labour-table">
            <thead>
              <tr>
                <th className="box">#</th>
                <th>{t('labour.name')}</th>
                <th>{t('labour.attendance')}</th>
                <th className="box">{t('labour.ot')}</th>
                <th className="num">{t('labour.rate')}</th>
                <th className="num">{t('use.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p, l) => {
                const line = lines[l]!;
                return (
                  <tr key={p.id} className={state.line === l ? 'wrong' : undefined}>
                    <td className="box muted line-no">{l + 1}</td>
                    <td className="wide" data-label={t('labour.name')}>
                      <strong>{p.name}</strong>
                      {p.kind === 'staff' && <span className="pill common small-pill">{t('labour.staff')}</span>}
                    </td>
                    <td data-label={t('labour.attendance')}>
                      <span className="quick-time">
                        {(['P', 'A'] as const).map((mark) => (
                          <button
                            key={mark}
                            type="button"
                            className={`chip mark-${mark}${line.mark === mark ? ' on' : ''}`}
                            aria-pressed={line.mark === mark}
                            aria-label={`${p.name}: ${t(`labour.mark.${mark}`)}`}
                            title={t(`labour.mark.${mark}`)}
                            onClick={() => change(l, { mark: line.mark === mark ? '' : mark, ot: mark === 'A' ? '' : line.ot })}
                          >{mark}</button>
                        ))}
                      </span>
                    </td>
                    <td className="box" data-label={t('labour.ot')}>
                      <span className="qty-with-unit">
                        <input
                          value={line.ot}
                          onChange={(e) => change(l, { ot: e.target.value })}
                          disabled={line.mark !== 'P'}
                          inputMode="decimal"
                          className="num"
                          placeholder="0"
                          aria-label={`${t('labour.ot')}, ${p.name}`}
                        />
                        <span className="unit-tag">{t('labour.hrs')}</span>
                      </span>
                    </td>
                    <td className={p.rate === null ? 'num minus' : 'num'} data-label={t('labour.rate')}>
                      {p.rate === null ? t('labour.noRate') : `${showPaise(p.rate)} ${t(`labour.per.${p.kind}`)}`}
                    </td>
                    <td className="num result" data-label={t('use.amount')}>{amounts[l] == null ? '—' : showPaise(amounts[l])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="work-total-bar">
        <span>{t('labour.marked', { p: count('P'), a: count('A') })} · {t('labour.dayTotal')} <strong>{showPaise(total)}</strong></span>
        <button type="submit" className="btn" disabled={pending}>{pending ? t('saving') : t('labour.save')}</button>
      </div>
    </form>
  );
}

const emptyOther = (): OtherLine => ({ description: '', costHead: 'site_overhead', quantity: '', rate: '' });

/** Anything else the site cost today: tractor, labour colony, room, light and petrol. What it is, what for, how many × rate. */
export function OtherCostForm({ action }: { action: Action }) {
  const t = useTranslations('report');
  const tAll = useTranslations();
  const [state, formAction, pending] = useActionState(action, {});
  const [lines, setLines] = useState<OtherLine[]>([emptyOther(), emptyOther()]);

  useEffect(() => {
    if (state.saved) setLines([emptyOther(), emptyOther()]);
  }, [state.saved]);

  const change = (l: number, patch: Partial<OtherLine>) => setLines((all) => all.map((x, i) => (i === l ? { ...x, ...patch } : x)));
  const amounts = lines.map((line) => (line.rate.trim() ? preview(line.quantity || '1', line.rate) : null));
  const total = amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);

  return (
    <form action={formAction} className="card work-builder">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="work-builder-head">
        <h2>{t('other.addTitle')}</h2>
        <p className="hint">{t('other.addHint')}</p>
      </div>
      <Problem state={state} t={t} />

      <div className="activity">
        <div className="table-wrap">
          <table className="measure-table use-table">
            <thead>
              <tr>
                <th className="box">#</th>
                <th>{t('other.description')}</th>
                <th className="box">{t('other.head')}</th>
                <th className="box">{t('other.quantity')}</th>
                <th className="box">{t('other.rate')}</th>
                <th className="num">{t('use.amount')}</th>
                <th aria-label={t('use.removeLine')} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, l) => (
                <tr key={l} className={state.line === l ? 'wrong' : undefined}>
                  <td className="box muted line-no">{l + 1}</td>
                  <td className="wide" data-label={t('other.description')}>
                    <input
                      value={line.description}
                      onChange={(e) => change(l, { description: e.target.value })}
                      className="remark-input"
                      placeholder={l === 0 ? t('other.example') : undefined}
                      aria-label={`${t('other.description')}, ${t('work.lineNo', { n: l + 1 })}`}
                    />
                  </td>
                  <td className="box" data-label={t('other.head')}>
                    <SearchSelect
                      value={line.costHead}
                      onChange={(v) => change(l, { costHead: v })}
                      aria-label={`${t('other.head')}, ${t('work.lineNo', { n: l + 1 })}`}
                      options={HEADS.map((h) => ({ value: h, label: tAll(`options.cost_head.${h}`) }))}
                    />
                  </td>
                  <td className="box" data-label={t('other.quantity')}>
                    <input
                      value={line.quantity}
                      onChange={(e) => change(l, { quantity: e.target.value })}
                      inputMode="decimal"
                      className="num"
                      placeholder="1"
                      aria-label={`${t('other.quantity')}, ${t('work.lineNo', { n: l + 1 })}`}
                    />
                  </td>
                  <td className="box" data-label={t('other.rate')}>
                    <input
                      value={line.rate}
                      onChange={(e) => change(l, { rate: e.target.value })}
                      inputMode="decimal"
                      className="num"
                      aria-label={`${t('other.rate')}, ${t('work.lineNo', { n: l + 1 })}`}
                    />
                  </td>
                  <td className="num result" data-label={t('use.amount')}>{amounts[l] == null ? '—' : showPaise(amounts[l])}</td>
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
              ))}
            </tbody>
          </table>
        </div>
        <div className="activity-foot">
          <button type="button" className="btn ghost small" onClick={() => setLines((all) => [...all, emptyOther()])}>
            ＋ {t('other.addLine')}
          </button>
        </div>
      </div>

      <div className="work-total-bar">
        <span>{t('other.dayTotal')} <strong>{showPaise(total)}</strong></span>
        <button type="submit" className="btn" disabled={pending}>{pending ? t('saving') : t('other.save')}</button>
      </div>
    </form>
  );
}
