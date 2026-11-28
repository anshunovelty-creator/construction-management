'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { quantityToMilli } from '@/lib/ledger/bill-items';
import { COST_HEADS } from '@/lib/ledger/types';
import { rupeesToPaise, showPaise } from '@/lib/money';
import { dayAmount, otCenti, type PersonKind } from '@/lib/wages';
import { amountPaise } from '@/lib/work';
import { AccountOptions } from '@/components/account-options';
import { Help } from '@/components/help';
import { Icon } from '@/components/icons';
import { SearchSelect } from '@/components/search-select';
import { onPhone, useUnsaved } from '@/components/unsaved';

/** What saving comes back with: when it was saved, or the mistake and the line it is on (from 0). */
export interface LineState {
  error?: string;
  line?: number;
  detail?: string;
  saved?: number;
}

export interface LabourLine {
  partyId: string;
  /** P present, H half day (workers only), A absent, empty not marked yet. */
  mark: 'P' | 'H' | 'A' | '';
  /** Overtime hours past the 8-hour day, for those present. */
  ot: string;
}

export interface OtherLine {
  description: string;
  costHead: string;
  quantity: string;
  rate: string;
  /** The account it was paid from; empty while not paid (a bill will come). */
  paidFrom: string;
}

/**
 * A worker or staff member not yet marked for the day: their rate from Setup (paise per hour, or per month for staff)
 * and what a day present pays (for staff, the day's share of their fixed salary; null without a rate).
 */
export interface Person {
  id: string;
  name: string;
  kind: PersonKind;
  rate: number | null;
  dayPay: number | null;
  /** Usually works at this site, so they come first. */
  here?: boolean;
  /** Already present at another site this day. */
  elsewhere?: boolean;
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
  const present = line.mark === 'P' || line.mark === 'H';
  if (!line.mark || (present && p.dayPay === null)) return null;
  try {
    return dayAmount(present, present ? otCenti(line.ot) : 0, p.dayPay ?? 0, line.mark === 'H');
  } catch {
    return null;
  }
}

/**
 * Who came today: staff first, then workers, like the site sheet. Tap P, H (half day) or A for each, and type OT hours past the
 * 8-hour day for those present. The pay comes from the rate in Setup. People left unmarked are not saved.
 */
export function LabourForm({ people, action }: { people: Person[]; action: Action }) {
  const t = useTranslations('report');
  const [state, formAction, pending] = useActionState(action, {});
  const [lines, setLines] = useState(() => people.map((p): LabourLine => ({ partyId: p.id, mark: '', ot: '' })));

  // This site's people first; the rest are a tap away. With nobody known here yet, everyone is shown.
  const anyHere = people.some((p) => p.here);
  const [all, setAll] = useState(false);
  const [find, setFind] = useState('');
  const word = find.trim().toLowerCase();
  const shows = (p: Person, l: number) => (word ? p.name.toLowerCase().includes(word) : all || !anyHere || p.here || Boolean(lines[l]!.mark));
  const others = anyHere ? people.filter((p, l) => !p.here && !lines[l]!.mark).length : 0;
  const change = (l: number, patch: Partial<LabourLine>) => setLines((all) => all.map((x, i) => (i === l ? { ...x, ...patch } : x)));
  const amounts = people.map((p, l) => pay(p, lines[l]!));
  const total = amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
  useUnsaved(() => lines.some((x) => x.mark));
  const count = (mark: 'P' | 'H' | 'A') => lines.filter((x) => x.mark === mark).length;

  return (
    <form action={formAction} className="card work-builder">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="work-builder-head">
        <h2>{t('labour.addTitle')}</h2>
        <Help title={t('help')}>{t('labour.addHint')}</Help>
        <button type="button" className="btn ghost small" onClick={() => setLines((was) => was.map((x, l) => (x.mark || people[l]!.elsewhere || !shows(people[l]!, l) ? x : { ...x, mark: 'P' })))}>
          {t('labour.allPresent')}
        </button>
      </div>
      <Problem state={state} t={t} />
      {people.length > 8 && (
        <input type="search" className="labour-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('labour.find')} aria-label={t('labour.find')} />
      )}

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
                if (!shows(p, l)) return null;
                return (
                  <tr key={p.id} className={[state.line === l && 'wrong', line.mark !== 'P' && line.mark !== 'H' && 'unmarked', p.kind === 'staff' && 'staff'].filter(Boolean).join(' ') || undefined}>
                    <td className="box muted line-no">{l + 1}</td>
                    <td className="wide" data-label={t('labour.name')}>
                      <strong>{p.name}</strong>
                      {p.kind === 'staff' && <span className="pill common small-pill">{t('labour.staff')}</span>}
                      {p.elsewhere && <small className="muted elsewhere">{t('labour.elsewhere')}</small>}
                    </td>
                    <td className="mark" data-label={t('labour.attendance')}>
                      <span className="quick-time">
                        {(p.kind === 'staff' ? ['P', 'A'] as const : ['P', 'H', 'A'] as const).map((mark) => (
                          <button
                            key={mark}
                            type="button"
                            className={`chip mark-${mark}${line.mark === mark ? ' on' : ''}`}
                            disabled={mark !== 'A' && p.elsewhere}
                            aria-pressed={line.mark === mark}
                            aria-label={`${p.name}: ${t(`labour.mark.${mark}`)}`}
                            title={t(`labour.mark.${mark}`)}
                            onClick={() => change(l, { mark: line.mark === mark ? '' : mark, ot: mark === 'A' ? '' : line.ot })}
                          >{mark}</button>
                        ))}
                      </span>
                    </td>
                    <td className="box" data-label={t('labour.ot')}>
                      {p.kind === 'staff' ? <span className="muted" title={t('labour.staffFixed')}>—</span> : (
                      <span className="qty-with-unit">
                        <input
                          value={line.ot}
                          onChange={(e) => change(l, { ot: e.target.value })}
                          disabled={line.mark !== 'P' && line.mark !== 'H'}
                          inputMode="decimal"
                          className="num"
                          placeholder="0"
                          aria-label={`${t('labour.ot')}, ${p.name}`}
                        />
                        <span className="unit-tag">{t('labour.hrs')}</span>
                      </span>
                      )}
                    </td>
                    <td className={p.rate === null ? 'num rate minus' : 'num rate'} data-label={t('labour.rate')}>
                      {p.rate === null ? t('labour.noRate') : `${showPaise(p.rate)} ${t(`labour.per.${p.kind}`)}`}
                    </td>
                    <td className="num result" data-label={t('use.amount')}>{amounts[l] == null ? '—' : showPaise(amounts[l])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!word && others > 0 && (
          <div className="activity-foot">
            <button type="button" className="btn ghost small" onClick={() => setAll((on) => !on)}>{t(all ? 'labour.onlyHere' : 'labour.others', { n: others })}</button>
          </div>
        )}
      </div>

      <div className="work-total-bar">
        <span>{t('labour.marked', { p: count('P'), h: count('H'), a: count('A') })} · {t('labour.dayTotal')} <strong>{showPaise(total)}</strong></span>
        <button type="submit" className="btn" disabled={pending}>{pending ? t('saving') : t('labour.save')}</button>
      </div>
    </form>
  );
}

const emptyOther = (): OtherLine => ({ description: '', costHead: 'site_overhead', quantity: '', rate: '', paidFrom: '' });

/** Anything else the site cost today: tractor, labour colony, room, light and petrol. What it is, what for, how many × rate. */
export function OtherCostForm({ action, accounts }: { action: Action; accounts: { id: string; name: string; kind: string }[] }) {
  const t = useTranslations('report');
  const tAll = useTranslations();
  const [state, formAction, pending] = useActionState(action, {});
  const [lines, setLines] = useState<OtherLine[]>([emptyOther(), emptyOther()]);

  useEffect(() => {
    if (state.saved) setLines(onPhone() ? [emptyOther()] : [emptyOther(), emptyOther()]);
    else if (onPhone()) setLines((all) => all.slice(0, 1));
  }, [state.saved]);

  useUnsaved(() => lines.some((x) => x.description.trim() || x.quantity.trim() || x.rate.trim()));
  const change = (l: number, patch: Partial<OtherLine>) => setLines((all) => all.map((x, i) => (i === l ? { ...x, ...patch } : x)));
  const amounts = lines.map((line) => (line.rate.trim() ? preview(line.quantity || '1', line.rate) : null));
  const total = amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);

  return (
    <form action={formAction} className="card work-builder">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="work-builder-head">
        <h2>{t('other.addTitle')}</h2>
        <Help title={t('help')}>{t('other.addHint')}</Help>
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
                {accounts.length > 0 && <th>{t('other.paidFrom')}</th>}
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
                  {accounts.length > 0 && <td className="box" data-label={t('other.paidFrom')}>
                    <select value={line.paidFrom} onChange={(e) => change(l, { paidFrom: e.target.value })} aria-label={`${t('other.paidFrom')}, ${t('work.lineNo', { n: l + 1 })}`}>
                      <option value="">{t('other.notPaid')}</option>
                      <AccountOptions accounts={accounts.map(({ id, name, kind }) => ({ id, name, kind }))} />
                    </select>
                  </td>}
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

/** One note for the day: what kind of work was done, any extra work. Saved over the last one; saved empty, it goes. */
export function NoteForm({ note, action }: { note: string; action: Action }) {
  const t = useTranslations('report');
  const [state, formAction, pending] = useActionState(action, {});
  const [text, setText] = useState(note);
  // The page sends the saved note again after a save, so this clears by itself.
  const changed = text.trim() !== note;
  useUnsaved(() => changed);

  return (
    <form action={formAction} className="card work-builder">
      <Problem state={state} t={t} />
      <textarea
        name="note"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={4000}
        className="report-note"
        placeholder={t('note.example')}
        aria-label={t('noteHeading')}
      />
      <div className="work-total-bar">
        <span className="muted">{changed ? t('note.notSaved') : note ? t('note.saved') : ''}</span>
        <button type="submit" className="btn" disabled={pending || !changed}>{pending ? t('saving') : t('note.save')}</button>
      </div>
    </form>
  );
}
