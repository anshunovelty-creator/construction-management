'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { sameName } from '@/lib/delete';
import type { DemoState } from '../actions';

/** The demo records, all ticked, and a box where CONFIRM must be typed before they go to the recycle bin. */
export function DemoClear({ items, action }: {
  items: { kind: string; id: string; name: string; from: string }[];
  action: (state: DemoState, data: FormData) => Promise<DemoState>;
}) {
  const t = useTranslations('bin');
  const tUsed = useTranslations('masters.delete.usedBy');
  const [state, formAction, pending] = useActionState(action, {});
  const [typed, setTyped] = useState('');
  // After each clear the box empties, so what is left (ticked again) is never cleared by a second tap.
  useEffect(() => setTyped(''), [state]);

  return (
    <>
      {state.moved && (
        <div className="card demo-result" role="status">
          {state.moved.length > 0 && <p className="banner">{t('demo.moved', { count: state.moved.length, names: state.moved.join(', ') })}</p>}
          {state.kept && state.kept.length > 0 && (
            <>
              <p className="banner bad">{t('demo.kept', { count: state.kept.length })}</p>
              <ul>
                {state.kept.map((k) => (
                  <li key={k.name}><b>{k.name}</b>: {tUsed.has(k.used) ? tUsed(k.used) : k.used}</li>
                ))}
              </ul>
              <p className="hint">{t('demo.keptHint')}</p>
            </>
          )}
          <Link href="/bin" className="underline">{t('demo.openBin')}</Link>
        </div>
      )}

      {items.length === 0 ? (
        <p className="empty">{t('demo.none')}</p>
      ) : (
        <form action={formAction} className="card demo-form">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th aria-label={t('demo.pick')} />
                  <th>{t('name')}</th>
                  <th>{t('from')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.kind}:${item.id}`}>
                    <td>
                      <input type="checkbox" name="pick" value={`${item.kind}:${item.id}:${item.name}`} defaultChecked
                        aria-label={t('demo.pickOne', { name: item.name })} />
                    </td>
                    <td><b>{item.name}</b></td>
                    <td>{item.from}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {state.error && <p className="error form-error" role="alert">{t(`demo.errors.${state.error}`)}</p>}
          <label className="demo-confirm">
            <span>{t('demo.typeConfirm')}</span>
            <input name="confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="CONFIRM" />
          </label>
          <button type="submit" className="btn danger" disabled={pending || !sameName(typed, 'CONFIRM')}>
            {pending ? t('demo.clearing') : t('demo.clear')}
          </button>
        </form>
      )}
    </>
  );
}
