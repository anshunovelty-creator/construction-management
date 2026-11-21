'use client';

import { useOptimistic, useTransition } from 'react';
import { switchPf } from './actions';

/**
 * A PF on/off switch for these people from a month on. It flips at once and saves in place: no page change, so nothing
 * on the page moves. If saving fails, it flips back when the page refreshes.
 */
export function PfSwitch({ ids, month, cut, labelOn, labelOff }: { ids: string[]; month: string; cut: boolean; labelOn: string; labelOff: string }) {
  const [on, setOn] = useOptimistic(cut);
  const [pending, start] = useTransition();
  const label = on ? labelOff : labelOn;
  return (
    <button type="button" role="switch" aria-checked={on} aria-busy={pending} aria-label={label} title={label} className="switch no-print"
      onClick={() => start(async () => { setOn(!on); await switchPf(ids, month, !on); })} />
  );
}
