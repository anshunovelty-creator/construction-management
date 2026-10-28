'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

/** "+ Add bill" and "+ Pay" on a party's page: each opens its short form in a pop-up over the page. */
export function QuickAdd({ name, bill, pay }: { name: string; bill: React.ReactNode; pay: React.ReactNode }) {
  const t = useTranslations('quick');
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<'bill' | 'pay' | null>(null);
  const show = (which: 'bill' | 'pay') => {
    setOpen(which);
    dialog.current?.showModal();
  };
  const title = open && t(open === 'bill' ? 'billTitle' : 'payTitle', { name });
  return (
    <div className="quick-add">
      <div className="quick-buttons">
        <button type="button" className="btn big" aria-haspopup="dialog" onClick={() => show('bill')}>＋ {t('addBill')}</button>
        <button type="button" className="btn big" aria-haspopup="dialog" onClick={() => show('pay')}>＋ {t('pay')}</button>
      </div>
      {/* Esc closes it too; a click on the dimmed page around it closes it. */}
      <dialog
        ref={dialog}
        className="card quick-dialog"
        aria-label={title || undefined}
        onClose={() => setOpen(null)}
        onClick={(e) => e.target === dialog.current && dialog.current.close()}
      >
        {open && (
          <>
            <div className="quick-card-head">
              <h2>{title}</h2>
              <button type="button" className="btn ghost small" onClick={() => dialog.current?.close()}>{t('close')}</button>
            </div>
            {open === 'bill' ? bill : pay}
          </>
        )}
      </dialog>
    </div>
  );
}
