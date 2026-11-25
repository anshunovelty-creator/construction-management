'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useRef, useState } from 'react';
import { asRupees, toPaise } from '@/components/form';
import { useUnsaved } from '@/components/unsaved';
import { salaryFor } from '@/lib/labour';
import { showPaise } from '@/lib/money';
import type { MonthState } from './actions';

/** The Skill sheet's form. A save stays on the page, so a mistake loses nothing typed. */
export function MonthForm({ action, children }: { action: (state: MonthState, data: FormData) => Promise<MonthState>; children: React.ReactNode }) {
  const t = useTranslations('labour');
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  useUnsaved(() => Boolean(form.current?.querySelector('input[name=changed]')));
  return (
    <form ref={form} action={formAction}>
      {children}
      <div className="month-save">
        <button type="submit" className="btn" disabled={pending}>{t('save')}</button>
        {state.error && <p role="alert" className="error">{state.name && `${state.name}: `}{t(`errors.${state.error}`)}</p>}
        {!state.error && state.saved !== undefined && <p role="status" className="muted">{t('saved', { count: state.saved })}</p>}
      </div>
    </form>
  );
}

/**
 * One worker's pay per day, days, OT hours and salary for the month, all typed by hand: the rate in Setup is the daily
 * report's price, not what they are paid, so it is not used. The salary fills in from the pay per day (OT at a day ÷ 8)
 * and can be typed over. What is taken off and left is worked out once saved.
 */
export function MonthCells({ id, name, pay, days, ot, salary }: { id: string; name: string; pay: number; days: number; ot: number; salary: number }) {
  const t = useTranslations('salary');
  const start = { pay: pay ? asRupees(pay) : '', days: days ? String(days) : '', ot: ot ? String(ot) : '', salary: salary ? asRupees(salary) : '' };
  const [typed, setTyped] = useState(start);
  const worksOut = (v: typeof start) => salaryFor(Number(v.days) || 0, Number(v.ot) || 0, toPaise(v.pay));
  const worked = worksOut(typed);
  const change = (patch: Partial<typeof start>) => {
    const next = { ...typed, ...patch };
    // No pay per day, or no days typed to pay yet: a salary typed by hand stays.
    const fill = patch.salary === undefined && toPaise(next.pay) > 0 && (patch.pay === undefined || worksOut(next) > 0);
    setTyped(fill ? { ...next, salary: worksOut(next) ? asRupees(worksOut(next)) : '' } : next);
  };
  const changed = Number(typed.days) !== days || Number(typed.ot) !== ot || toPaise(typed.salary) !== salary || toPaise(typed.pay) !== pay;
  const number = (field: 'days' | 'ot', label: string, max: number) => (
    <td className="num typed">
      <input name={`${id}:${field}`} aria-label={`${name}: ${label}`} value={typed[field]} onChange={(e) => change({ [field]: e.target.value })}
        type="number" inputMode="decimal" min="0" max={max} step="0.01" placeholder="–" />
    </td>
  );
  const box = (field: 'pay' | 'salary', label: string) => (
    <input name={`${id}:${field}`} aria-label={`${name}: ${label}`} value={typed[field]} onChange={(e) => change({ [field]: e.target.value })}
      inputMode="decimal" pattern="[₹,\s\d]*(\.\d{1,2})?" placeholder="–" />
  );
  return (
    <>
      <td className="num typed">{box('pay', t('perDay'))}</td>
      {number('days', t('days'), 100)}
      {number('ot', t('otHours'), 999)}
      <td className="num typed">
        {box('salary', t('salary'))}
        {worked > 0 && worked !== toPaise(typed.salary) && <small className="muted">{t('worksOut', { amount: showPaise(worked) })}</small>}
        <input type="hidden" name={`${id}:name`} value={name} />
        {changed && <input type="hidden" name="changed" value={id} />}
      </td>
    </>
  );
}
