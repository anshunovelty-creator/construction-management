'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface CardDay {
  n: number;
  date: string;
  weekday: string;
  sunday: boolean;
  future: boolean;
  mark: '' | 'P' | 'A';
  ot: string;
}

const NEXT_MARK = { '': 'P', P: 'A', A: '' } as const;

/** A month's card, like the paper one: tap a date for present, again for absent, again to clear; OT under present days. */
export function AttendanceCard({ days, staff, nextId, nextName, action }: {
  days: CardDay[];
  staff: boolean;
  nextId?: string;
  nextName?: string;
  action: (data: FormData) => Promise<void>;
}) {
  const t = useTranslations('labour');
  const [marks, setMarks] = useState(() => new Map(days.map((d) => [d.n, d.mark])));
  const [ots, setOts] = useState(() => new Map(days.map((d) => [d.n, d.ot])));
  const count = (mark: 'P' | 'A') => [...marks.values()].filter((m) => m === mark).length;
  const otTotal = days.reduce((s, d) => s + (marks.get(d.n) === 'P' ? Number(ots.get(d.n)) || 0 : 0), 0);
  const fillPresent = () => setMarks(new Map(days.map((d) => [d.n, d.future ? d.mark : marks.get(d.n) || 'P'])));

  return (
    <form action={action} className="card">
      <div className="att-summary" role="status">
        <span className="plus"><b>{count('P')}</b> {t('present')}</span>
        <span className="minus"><b>{count('A')}</b> {t('absent')}</span>
        {!staff && <span><b>{Math.round(otTotal * 100) / 100}</b> {t('otHours')}</span>}
        <button type="button" className="btn ghost small" onClick={fillPresent}>{t('fillPresent')}</button>
      </div>
      <div className="att-grid">
        {days.map((d) => {
          const mark = marks.get(d.n) ?? '';
          return (
            <div key={d.n} className={`att-day${d.sunday ? ' sunday' : ''}`}>
              <button type="button" disabled={d.future} className={`att-mark${mark ? ` mark-${mark}` : ''}`}
                aria-label={`${d.date}: ${t(`marks.${mark || 'none'}`)}`}
                onClick={() => setMarks(new Map(marks).set(d.n, NEXT_MARK[mark]))}>
                <span className="att-date">{d.n} <small>{d.weekday}</small></span>
                <b>{mark || '–'}</b>
              </button>
              <input type="hidden" name={`d${d.n}`} value={mark} />
              {!staff && (
                <input name={`ot${d.n}`} inputMode="decimal" aria-label={t('otOn', { date: d.date })} placeholder={t('ot')} disabled={mark !== 'P'}
                  value={mark === 'P' ? ots.get(d.n) ?? '' : ''} onChange={(e) => setOts(new Map(ots).set(d.n, e.target.value))} />
              )}
            </div>
          );
        })}
      </div>
      <div className="att-actions">
        <button type="submit" className="btn">{t('saveCard')}</button>
        {nextId && <button type="submit" name="next" value={nextId} className="btn ghost">{t('saveAndNext', { name: nextName ?? '' })}</button>}
      </div>
    </form>
  );
}
