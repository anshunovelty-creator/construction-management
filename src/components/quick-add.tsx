'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/** "+ Add bill" and "+ Pay" on a party's page: each opens its short form in a pop-up over the page. */
export function QuickAdd({ name, bill, pay }: { name: string; bill: React.ReactNode; pay: React.ReactNode }) {
  const t = useTranslations('quick');
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<'bill' | 'pay' | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const show = (which: 'bill' | 'pay') => {
    setSaved(null);
    setOpen(which);
    dialog.current?.showModal();
  };
  // Once the entry is saved the pop-up closes; the page behind already shows the new totals.
  useEffect(() => {
    const box = dialog.current;
    const done = (e: Event) => {
      setSaved((e as CustomEvent<string>).detail);
      box?.close();
    };
    box?.addEventListener('entry-saved', done);
    return () => box?.removeEventListener('entry-saved', done);
  }, []);
  const title = open && t(open === 'bill' ? 'billTitle' : 'payTitle', { name });
  return (
    <div className="quick-add">
      <div className="quick-buttons">
        <button type="button" className="btn big navy" aria-haspopup="dialog" onClick={() => show('bill')}>＋ {t('addBill')}</button>
        <button type="button" className="btn big" aria-haspopup="dialog" onClick={() => show('pay')}>₹ {t('pay')}</button>
        {saved && <p role="status" className="quick-saved">{t('saved', { serial: saved })}</p>}
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
