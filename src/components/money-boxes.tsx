'use client';

import { useTranslations } from 'next-intl';
import type { Ref } from 'react';
import { toPaise } from '@/components/form';
import { groupRupees } from '@/lib/money';
import { rupeesInWords } from '@/lib/words';

/** The day before an ISO date, for the Yesterday chip. */
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** The big amount box of a money pop-up: grouped the Indian way as it is typed, and said back in words. */
export function AmountBox({ text, setText, label, ref }: { text: string; setText: (text: string) => void; label: string; ref?: Ref<HTMLInputElement> }) {
  const t = useTranslations();
  const paise = toPaise(text);
  // Reformats as it is typed, and puts the cursor back after the same digit so a fix in the middle stays in place.
  const type = (box: HTMLInputElement) => {
    const digitsBefore = box.value.slice(0, box.selectionStart ?? 0).replace(/[^\d.]/g, '').length;
    const next = groupRupees(box.value);
    setText(next);
    requestAnimationFrame(() => {
      let at = 0;
      for (let seen = 0; seen < digitsBefore && at < next.length; at++) if (/[\d.]/.test(next[at]!)) seen++;
      box.setSelectionRange(at, at);
    });
  };
  return (
    <>
      <label className="rcv-amount">
        <span className="sr-only">{label}</span>
        <span className="rcv-rupee" aria-hidden="true">₹</span>
        <input ref={ref} autoFocus type="text" inputMode="decimal" autoComplete="off" placeholder="0" required
          style={{ width: `${Math.max(text.length, 1) + 0.5}ch` }}
          value={text} onChange={(e) => type(e.target)} />
      </label>
      <p className="rcv-words">{paise > 0 ? rupeesInWords(paise) : t('client.receive.typeAmount')}</p>
    </>
  );
}

/** The date of a money pop-up: Today, Yesterday, or any day up to today. */
export function DateBox({ date, setDate, today, label }: { date: string; setDate: (date: string) => void; today: string; label: string }) {
  const t = useTranslations('client.receive');
  const chip = (words: string, value: string) => (
    <button type="button" className={`chip${date === value ? ' on' : ''}`} aria-pressed={date === value} onClick={() => setDate(value)}>{words}</button>
  );
  return (
    <fieldset className="rcv-group">
      <legend>{label}</legend>
      <div className="rcv-dates">
        {chip(t('today'), today)}
        {chip(t('yesterday'), dayBefore(today))}
        <input type="date" required aria-label={label} value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </div>
    </fieldset>
  );
}
