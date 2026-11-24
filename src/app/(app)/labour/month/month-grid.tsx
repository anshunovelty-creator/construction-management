'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { asRupees, toPaise } from '@/components/form';
import { salaryFor } from '@/lib/labour';
import { roundOffSmall, showPaise } from '@/lib/money';
import type { MonthState } from '../actions';

/** One person's month as typed. */
export interface GridMember {
  id: string;
  name: string;
  skill: string;
  rate: number;
  days: string;
  ot: string;
  advance: string;
  paid: string;
  note: string;
}
/** A family's month: its members, the head first. The family's money is typed on the head. */
export interface GridFamily {
  members: GridMember[];
  /** What the months before left the family: above zero to pay, below zero paid extra. */
  before: number;
  /** This month's money kept elsewhere: advances given on Pay, a member's from before they joined, and old additions and deductions. */
  otherNet: number;
  otherPaid: number;
  /** The part of otherNet that is advances: shown in the Advance column. */
  otherAdvance: number;
}
type Field = 'days' | 'ot' | 'advance' | 'note';

const RUPEES = '[₹,\\s\\d]*(\\.\\d{1,2})?';
const asNumber = (text: string) => Number(text) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The same figures whichever way they were typed: 2,000 is 2000. */
const figures = (r: Pick<GridMember, Field>) => JSON.stringify([
  asNumber(r.days), asNumber(r.ot), toPaise(r.advance), r.note.trim(),
]);

function Money({ paise, tone }: { paise: number; tone?: 'plus' | 'minus' }) {
  return <td className={`num${paise === 0 ? ' muted' : tone ? ` strong ${tone}` : ''}`}>{paise === 0 ? '–' : showPaise(paise)}</td>;
}

/**
 * One family's month. A family of one is a single row. A bigger family has the head's row with the family's totals and
 * money, and a sub-row per member (the head too) for their salary per day, days and OT. Everything works itself out as
 * it is typed; only changed people are sent to be saved.
 */
function FamilyRows({ family }: { family: GridFamily }) {
  const t = useTranslations('labour');
  const { members } = family;
  const head = members[0]!;
  const [typed, setTyped] = useState(() => Object.fromEntries(members.map((m) => [m.id, m as Pick<GridMember, Field>])));
  // A day's salary changed here counts from this month on. Left empty, it stays as it was.
  const [perDay, setPerDay] = useState(() => Object.fromEntries(members.map((m) => [m.id, asRupees(m.rate)])));
  const rateOf = (m: GridMember) => (perDay[m.id]!.trim() ? toPaise(perDay[m.id]!) : m.rate);
  const salaryOf = (m: GridMember) => salaryFor(asNumber(typed[m.id]!.days), asNumber(typed[m.id]!.ot), rateOf(m));

  const own = typed[head.id]!;
  const salary = members.reduce((s, m) => s + salaryOf(m), 0);
  const toPay = family.before + salary + family.otherNet - toPaise(own.advance);
  const left = roundOffSmall(toPay - toPaise(head.paid) - family.otherPaid);
  const names = members.map((m) => m.name).join(' ');

  const input = (m: GridMember, field: Field, label: string) => ({
    name: `${m.id}:${field}`,
    'aria-label': `${m.name}: ${label}`,
    value: typed[m.id]![field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTyped({ ...typed, [m.id]: { ...typed[m.id]!, [field]: e.target.value } }),
  });
  const rupees = (field: Field, label: string) => (
    <td className="num"><input {...input(head, field, label)} inputMode="decimal" pattern={RUPEES} title={t('errors.amount')} /></td>
  );

  /** Who it is, and what rides along unseen: a member's money from before they joined, kept as it was. */
  const nameCell = (m: GridMember, note?: string) => (
    <td>
      <Link href={`/labour/family/${head.id}`} className="party-link">{m.name}</Link>
      {note && <small className="muted">{note}</small>}
      <input type="hidden" name={`${m.id}:name`} value={m.name} />
      <input type="hidden" name={`${m.id}:old_rate`} value={m.rate} />
      {m !== head && (['advance', 'note'] as const).map((f) => <input key={f} type="hidden" name={`${m.id}:${f}`} value={typed[m.id]![f]} />)}
      {(figures(typed[m.id]!) !== figures(m) || rateOf(m) !== m.rate) && <input type="hidden" name="changed" value={m.id} />}
    </td>
  );
  const dayCells = (m: GridMember) => (
    <>
      <td className={`num per-day${rateOf(m) !== m.rate ? ' changed-rate' : ''}`}>
        <input name={`${m.id}:rate`} aria-label={`${m.name}: ${t('rateShort')}`} value={perDay[m.id]}
          onChange={(e) => setPerDay({ ...perDay, [m.id]: e.target.value })} inputMode="decimal" pattern={RUPEES} title={t('errors.rate')} />
      </td>
      <td className="num"><input {...input(m, 'days', t('days'))} type="number" inputMode="decimal" min="0" max="100" step="0.01" title={t('errors.days')} /></td>
      <td className="num"><input {...input(m, 'ot', t('otHours'))} type="number" inputMode="decimal" min="0" max="999" step="0.01" title={t('errors.ot')} /></td>
      <Money paise={salaryOf(m)} />
    </>
  );
  // Money paid is on the Pay tab, with its date and account; here it only shows.
  const given = (paise: number) => <td className={`num${paise === 0 ? ' muted' : ''}`}>{paise === 0 ? '–' : showPaise(paise)}</td>;
  const others = [
    family.otherAdvance ? t('otherAdvance', { amount: showPaise(family.otherAdvance) }) : '',
    family.otherNet + family.otherAdvance ? t(family.otherNet + family.otherAdvance < 0 ? 'otherCut' : 'otherAdded', { amount: showPaise(Math.abs(family.otherNet + family.otherAdvance)) }) : '',
  ].filter(Boolean).join(' · ');
  const moneyCells = (
    <>
      {rupees('advance', t('advance'))}
      <td><input {...input(head, 'note', t('reason'))} /></td>
      <td className={`num${family.before === 0 ? ' muted' : family.before < 0 ? ' plus' : ' minus'}`}>
        {family.before === 0 ? '–' : showPaise(family.before)}
        {family.before !== 0 && <span className="balance-word">{t(family.before < 0 ? 'beforeExtra' : 'beforeToPay')}</span>}
      </td>
      <Money paise={Math.max(toPay, 0)} />
      {given(toPaise(head.paid) + family.otherPaid)}
      {/* One column for what is left: red to pay, or green paid extra, so the month fits a laptop without scrolling. */}
      <td className={`num${left === 0 ? ' muted' : left < 0 ? ' strong plus' : ' strong minus'}`}>
        {left === 0 ? '–' : showPaise(left)}
        {left !== 0 && <span className="balance-word">{t(left < 0 ? 'beforeExtra' : 'beforeToPay')}</span>}
      </td>
    </>
  );

  if (members.length === 1) {
    return (
      <tr id={head.id} data-name={names} className={left < 0 ? 'extra-month' : undefined}>
        {nameCell(head, [head.skill, others].filter(Boolean).join(' · '))}
        {dayCells(head)}
        {moneyCells}
      </tr>
    );
  }
  const sum = (field: 'days' | 'ot') => round2(members.reduce((s, m) => s + asNumber(typed[m.id]![field]), 0));
  return (
    <>
      <tr id={head.id} data-name={names} className={`family-row${left < 0 ? ' extra-month' : ''}`}>
        <td>
          <Link href={`/labour/family/${head.id}`} className="party-link">{head.name}</Link>
          <small className="muted">{[t('familyOfCount', { count: members.length }), others].filter(Boolean).join(' · ')}</small>
        </td>
        <td className="num muted">–</td>
        <td className="num">{sum('days') || '–'}</td>
        <td className="num">{sum('ot') || '–'}</td>
        <Money paise={salary} />
        {moneyCells}
      </tr>
      {members.map((m) => (
        <tr key={m.id} id={m === head ? undefined : m.id} data-name={names} className="member-row">
          {nameCell(m, m === head ? t('head') : m.skill)}
          {dayCells(m)}
          <td colSpan={6} />
        </tr>
      ))}
    </>
  );
}

/** The month's sheet, one family to a group. A save stays on the page, so a mistake loses nothing typed. */
export function MonthGrid({ families, action }: {
  families: GridFamily[];
  action: (state: MonthState, data: FormData) => Promise<MonthState>;
}) {
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
              <th className="reason">{t('reason')}</th>
              <th className="num">{t('before')}</th>
              <th className="num">{t('toPay')}</th>
              <th className="num">{t('paid')}</th>
              <th className="num">{t('left')}</th>
            </tr>
          </thead>
          <tbody>
            {/* A family starts again from what the server holds once its saved figures change. */}
            {families.map((f) => (
              <FamilyRows key={JSON.stringify([f.before, f.otherNet, f.otherPaid, f.otherAdvance, ...f.members.map((m) => [m.id, figures(m), m.paid, m.rate])])} family={f} />
            ))}
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
