'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/** "+ Add bill" on a party's page opens the bill form in a pop-up; `pay` is the Pay button, which brings its own pop-up. */
export function QuickAdd({ name, bill, pay }: { name: string; bill: React.ReactNode; pay: React.ReactNode }) {
  const t = useTranslations('quick');
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const show = () => {
    setSaved(null);
    setOpen(true);
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
  const title = t('billTitle', { name });
  return (
    <div className="quick-add">
      <div className="quick-buttons">
        <button type="button" className="btn big navy" aria-haspopup="dialog" onClick={show}>＋ {t('addBill')}</button>
        {pay}
        {saved && <p role="status" className="quick-saved">{t('saved', { serial: saved })}</p>}
      </div>
      {/* Esc closes it too; a click on the dimmed page around it closes it. */}
      <dialog
        ref={dialog}
        className="card quick-dialog"
        aria-label={title}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialog.current && dialog.current.close()}
      >
        {open && (
          <>
            <div className="quick-card-head">
              <h2>{title}</h2>
              <button type="button" className="btn ghost small" onClick={() => dialog.current?.close()}>{t('close')}</button>
            </div>
            {bill}
          </>
        )}
      </dialog>
    </div>
  );
}
