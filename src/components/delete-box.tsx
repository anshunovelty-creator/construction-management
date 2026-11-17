'use client';

import { useState } from 'react';
import { sameName } from '@/lib/delete';

/**
 * "Delete" at the foot of a change page. Closed until tapped. An important record (`typeLabel` given) must have its
 * name typed before the button works, so nothing is deleted by a slip of the hand; the server checks the name again.
 */
export function DeleteBox({ action, name, title, warning, typeLabel, confirmLabel, error }: {
  action: (data: FormData) => Promise<void>;
  name: string;
  title: string;
  warning: string;
  /** "Type {name} to delete it". Left out: one tap deletes. */
  typeLabel?: string;
  confirmLabel: string;
  error?: string;
}) {
  const [typed, setTyped] = useState('');
  return (
    <details className="cancel card delete-box" open={Boolean(error)}>
      <summary>{title}</summary>
      <p className="hint">{warning}</p>
      {error && <p className="error form-error" role="alert">{error}</p>}
      <form action={action} className="delete-form">
        {typeLabel && (
          <label>
            <span>{typeLabel}</span>
            <input name="confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} />
          </label>
        )}
        <button type="submit" className="btn danger" disabled={Boolean(typeLabel) && !sameName(typed, name)}>{confirmLabel}</button>
      </form>
    </details>
  );
}
