'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { useUnsaved } from '@/components/unsaved';
import { showPaise } from '@/lib/money';
import type { PlacesState, WorkerPlaces } from './actions';

interface Row {
  id: string;
  name: string;
  skill: string;
  days: number;
  ot: number;
  /** A day's charged rate; null for a Labour login. */
  charge: number | null;
  lines: { placeId: string; days: string; ot: string }[];
}

/** A row per worker with days in the month: the place they were, or several places with the days at each. Only changed rows are sent. */
export function PlacesForm({ rows: given, places, action }: { rows: Row[]; places: { id: string; name: string }[]; action: (state: PlacesState, data: FormData) => Promise<PlacesState> }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, {});
  const [rows, setRows] = useState(given);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const set = (id: string, lines: Row['lines']) => {
    setRows((all) => all.map((r) => (r.id === id ? { ...r, lines } : r)));
    setChanged((c) => new Set(c).add(id));
  };
  useUnsaved(() => changed.size > 0);
  const payload: WorkerPlaces[] = rows.filter((r) => changed.has(r.id)).map(({ id, lines }) => ({ id, lines }));
  // Whole paise until the last step, like the server's own sum.
  const value = (r: Row, days: number, ot: number) => Math.round((Math.round(days * 100) * r.charge!) / 100 + (Math.round(ot * 100) * r.charge!) / 800);

  return (
    <form action={async (data) => { setChanged(new Set()); await formAction(data); }}>
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      <div className="card table-wrap flush">
        <table className="ledger supplied" id="supplied">
          <thead>
            <tr>
              <th>{t('labour.name')}</th>
              <th className="num">{t('labour.days')}</th>
              <th className="num">{t('labour.otHours')}</th>
              <th>{t('supplied.place')}</th>
              {rows.some((r) => r.charge !== null) && <><th className="num">{t('supplied.charged')}</th><th className="num">{t('supplied.value')}</th></>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const split = r.lines.length > 1;
              const left = (pick: 'days' | 'ot') => Math.round((r[pick] - r.lines.reduce((s, l) => s + (Number(l[pick]) || 0), 0)) * 100) / 100;
              const line = (i: number, patch: Partial<Row['lines'][number]>) => set(r.id, r.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
              return (
                <tr key={r.id} data-name={r.name}>
                  <td>{r.name}{r.skill && <span className="muted"> · {r.skill}</span>}</td>
                  <td className="num">{r.days}</td>
                  <td className="num">{r.ot || '–'}</td>
                  <td>
                    {(r.lines.length > 0 ? r.lines : [{ placeId: '', days: '', ot: '' }]).map((l, i) => (
                      <div key={i} className="place-line">
                        <select aria-label={t('supplied.placeOf', { name: r.name })} value={l.placeId} className={l.placeId ? undefined : 'bad'}
                          onChange={(e) => (r.lines.length ? line(i, { placeId: e.target.value }) : set(r.id, [{ placeId: e.target.value, days: '', ot: '' }]))}>
                          <option value="">{t('supplied.pick')}</option>
                          {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        {split && (
                          <>
                            <input aria-label={t('labour.days')} placeholder={t('supplied.daysShort')} inputMode="decimal" value={l.days} onChange={(e) => line(i, { days: e.target.value })} />
                            {r.ot > 0 && <input aria-label={t('labour.otHours')} placeholder={t('supplied.otShort')} inputMode="decimal" value={l.ot} onChange={(e) => line(i, { ot: e.target.value })} />}
                            <button type="button" className="btn ghost small" aria-label={t('supplied.removePlace')} onClick={() => set(r.id, r.lines.filter((_, j) => j !== i))}>×</button>
                          </>
                        )}
                      </div>
                    ))}
                    <button type="button" className="link-button" onClick={() => set(r.id, split
                      ? [...r.lines, { placeId: '', days: '', ot: '' }]
                      : [{ placeId: r.lines[0]?.placeId ?? '', days: String(r.days), ot: r.ot ? String(r.ot) : '' }, { placeId: '', days: '', ot: '' }])}>{t('supplied.split')}</button>
                    {split && (left('days') !== 0 || left('ot') !== 0) && <p className="hint minus">{t('supplied.leftOver', { days: String(left('days')), ot: String(left('ot')) })}</p>}
                  </td>
                  {r.charge !== null && <><td className="num">{showPaise(r.charge)}</td><td className="num strong">{showPaise(value(r, r.days, r.ot))}</td></>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {state.error && <p role="alert" className="banner bad">{state.name && <b>{state.name}: </b>}{t(`labour.errors.${state.error}`)}</p>}
      {state.saved !== undefined && changed.size === 0 && <p role="status" className="banner">{t('labour.saved', { count: state.saved })}</p>}
      <button type="submit" className="btn big" disabled={pending || changed.size === 0}>{pending ? '…' : t('supplied.savePlaces')}</button>
    </form>
  );
}
