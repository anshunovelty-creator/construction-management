'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { switchFirm } from '@/app/(app)/firm/actions';
import { Icon } from '@/components/icons';
import type { Firm } from '@/lib/firm';

/** The working firm at the top right. With more than one firm, tapping it lists them; tapping one switches. */
export function FirmSwitch({ firms, firm }: { firms: Firm[]; firm: Firm }) {
  const t = useTranslations('firm');
  const [state, action, pending] = useActionState(switchFirm, {});
  if (firms.length < 2) return <span className="firm-switch firm-pill"><Icon name="firm" size={16} />{firm.name}</span>;
  return (
    // A new key per firm closes the menu once the switch has gone through.
    <details key={firm.id} className="more firm-switch">
      <summary className="firm-pill" aria-label={t('switchLabel', { firm: firm.name })}>
        <Icon name="firm" size={16} />{firm.name}<Icon name="chevron" size={14} />
      </summary>
      <form action={action} className="more-menu card">
        <p className="eyebrow">{t('menuTitle')}</p>
        {firms.map((f) => (
          <button
            key={f.id}
            type="submit"
            name="firm"
            value={f.id}
            className="nav-link"
            aria-current={f.id === firm.id ? 'true' : undefined}
            disabled={pending}
          >
            {f.name}
          </button>
        ))}
        {state.failed && <p role="alert" className="error">{t('switchFailed')}</p>}
      </form>
    </details>
  );
}
