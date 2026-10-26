'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

/** "+ Add bill" and "+ Pay" on a party's page: each opens its short form in a card below. */
export function QuickAdd({ name, bill, pay }: { name: string; bill: React.ReactNode; pay: React.ReactNode }) {
  const t = useTranslations('quick');
  const [open, setOpen] = useState<'bill' | 'pay' | null>(null);
  const toggle = (which: 'bill' | 'pay') => setOpen(open === which ? null : which);
  return (
    <div className="quick-add">
      <div className="quick-buttons">
        <button type="button" className={`btn big${open === 'pay' ? ' ghost' : ''}`} aria-expanded={open === 'bill'} onClick={() => toggle('bill')}>
          ＋ {t('addBill')}
        </button>
        <button type="button" className={`btn big${open === 'bill' ? ' ghost' : ''}`} aria-expanded={open === 'pay'} onClick={() => toggle('pay')}>
          ＋ {t('pay')}
        </button>
      </div>
      {open && (
        <section className="card quick-card" aria-label={t(open === 'bill' ? 'billTitle' : 'payTitle', { name })}>
          <div className="quick-card-head">
            <h2>{t(open === 'bill' ? 'billTitle' : 'payTitle', { name })}</h2>
            <button type="button" className="btn ghost small" onClick={() => setOpen(null)}>{t('close')}</button>
          </div>
          {open === 'bill' ? bill : pay}
        </section>
      )}
    </div>
  );
}
