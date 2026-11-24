'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toPaise } from '@/components/form';
import { groupRupees, showPaise } from '@/lib/money';
import type { MatchInput } from '@/app/(app)/bankbook/[id]/match/actions';

export interface MatchLine { id: string; date: string; showDate: string; who: string; note: string; amount: number; clearedOn: string | null }

/**
 * A bank's lines beside its statement: tick what the statement has, and the difference works itself out as it is ticked.
 * What the bank should say = the opening and every line it had by the statement's date.
 */
export function MatchForm({ lines, opening, date: given, since, today, balance, overdrawn, save }: {
  lines: MatchLine[];
  /** What the bank had before these lines: its opening and lines cleared long ago. */
  opening: number;
  date: string;
  /** Lines the bank had before this are folded into `opening`, so an older statement is opened from the list instead. */
  since: string;
  today: string;
  balance: string;
  overdrawn: boolean;
  save: (input: MatchInput) => Promise<{ error: string; detail?: string } | { saved: true }>;
}) {
  const t = useTranslations();
  const [date, setDate] = useState(given);
  const [text, setText] = useState(balance);
  const [over, setOver] = useState(overdrawn);
  const [cleared, setCleared] = useState<Record<string, string>>(() => Object.fromEntries(lines.filter((l) => l.clearedOn).map((l) => [l.id, l.clearedOn!])));
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const shown = lines.filter((l) => l.date <= date || cleared[l.id]);
  const expected = opening + lines.reduce((s, l) => s + (cleared[l.id] && cleared[l.id]! <= date ? l.amount : 0), 0);
  const bank = (over ? -1 : 1) * toPaise(text);
  const difference = bank - expected;
  const waiting = shown.filter((l) => !cleared[l.id] || cleared[l.id]! > date);
  const tick = (l: MatchLine, on: boolean) => setCleared((all) => {
    const next = { ...all };
    if (on) next[l.id] = l.date > date ? date : l.date;
    else delete next[l.id];
    return next;
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof save>>;
      try {
        result = await save({
          date, balance: text, overdrawn: over,
          ticks: lines.filter((l) => cleared[l.id] && cleared[l.id] !== l.clearedOn).map((l) => ({ id: l.id, clearedOn: cleared[l.id]! })),
          unticks: lines.filter((l) => l.clearedOn && !cleared[l.id]).map((l) => l.id),
        });
      } catch {
        result = { error: 'not_saved' };
      }
      setMessage('saved' in result ? { bad: false, text: t('match.saved') } : { bad: true, text: `${t(`match.errors.${result.error}`)}${result.detail ? ` (${result.detail})` : ''}` });
    });
  };
  return (
    <form onSubmit={submit}>
      <div className="card labour-form">
        <div className="field"><label htmlFor="m-date">{t('match.date')}</label><input id="m-date" type="date" required value={date} min={since} max={today} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="m-balance">{t('match.balance')}</label>
          <input id="m-balance" inputMode="decimal" autoComplete="off" required value={text} onChange={(e) => setText(groupRupees(e.target.value))} /></div>
        <label className="check-line"><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} /> {t('match.overdrawn')}</label>
      </div>
      <div className="stats">
        <div className="stat card"><span className="stat-label">{t('match.expected')}</span><span className="stat-value">{showPaise(expected)}</span><span className="stat-note">{t('match.waiting', { count: waiting.length })}</span></div>
        <div className="stat card"><span className="stat-label">{t('match.bankSays')}</span><span className="stat-value">{text.trim() ? showPaise(bank) : '–'}</span></div>
        <div className={`stat card${text.trim() ? (difference === 0 ? ' done' : ' owe') : ''}`}><span className="stat-label">{t('match.difference')}</span>
          <span className="stat-value">{!text.trim() ? '–' : difference === 0 ? t('match.agrees') : showPaise(Math.abs(difference))}</span>
          {text.trim() && difference !== 0 && <span className="stat-note">{t(difference > 0 ? 'match.bankMore' : 'match.bankLess')}</span>}</div>
      </div>
      <div className="card table-wrap flush">
        <table className="ledger">
          <thead><tr><th>{t('match.has')}</th><th>{t('ledger.date')}</th><th>{t('bankbook.fromTo')}</th><th className="num">{t('bankbook.in')}</th><th className="num">{t('bankbook.out')}</th><th>{t('match.clearedOn')}</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={6} className="muted">{t('match.none')}</td></tr>}
            {shown.map((l) => (
              <tr key={l.id} className={cleared[l.id] ? 'muted' : undefined}>
                <td><input type="checkbox" className="tick" aria-label={`${l.showDate} ${l.who} ${showPaise(l.amount)}`} checked={Boolean(cleared[l.id])} onChange={(e) => tick(l, e.target.checked)} /></td>
                <td className="nowrap">{l.showDate}</td>
                <td>{l.who}{l.note && <span className="muted"> · {l.note}</span>}</td>
                <td className="num plus">{l.amount > 0 ? showPaise(l.amount) : ''}</td>
                <td className="num minus">{l.amount < 0 ? showPaise(-l.amount) : ''}</td>
                <td>{cleared[l.id] && <input type="date" aria-label={t('match.clearedOn')} value={cleared[l.id]} max={today} onChange={(e) => setCleared({ ...cleared, [l.id]: e.target.value })} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message && <p role={message.bad ? 'alert' : 'status'} className={`banner${message.bad ? ' bad' : ''}`}>{message.text}</p>}
      <button type="submit" className="btn big" disabled={pending || !text.trim()}>{pending ? '…' : t('match.save')}</button>
    </form>
  );
}
