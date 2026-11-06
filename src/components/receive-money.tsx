'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { startTransition, useRef, useState, useTransition } from 'react';
import { asRupees, toPaise, type FormState } from '@/components/form';
import { Icon } from '@/components/icons';
import type { Choice } from '@/lib/masters/registry';
import { groupRupees, roundOffSmall, showPaise } from '@/lib/money';
import { rupeesInWords } from '@/lib/words';

type Saved = { id: string; serial: string };

/** The day before an ISO date, for the Yesterday chip. */
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * The bar under the amount: what came in before (solid green), this payment (light green, grows as it is typed),
 * what is still to come (grey). Anything past the total is red: extra received has to go back.
 */
function Meter({ total, received, now }: { total: number; received: number; now: number }) {
  const whole = Math.max(total, received + now, 1);
  const width = (paise: number) => ({ width: `${(Math.max(paise, 0) * 100) / whole}%` });
  const before = Math.min(received, total);
  const adds = Math.min(received + now, total) - before;
  return (
    <div className="rcv-meter" aria-hidden="true">
      <i className="got" style={width(before)} />
      <i className="now" style={width(adds)} />
      <i className="extra" style={width(received + now - total)} />
    </div>
  );
}

/** Says what is left in words and colour: green still to come, red extra received. */
function Left({ paise, label }: { paise: number; label?: string }) {
  const t = useTranslations('client');
  if (paise === 0) return <p className="rcv-left done"><span>{t('nothingLeft')}</span></p>;
  return (
    <p className={`rcv-left ${paise > 0 ? 'plus' : 'minus'}`}>
      <span>{paise > 0 ? (label ?? t('balance')) : t('statuses.extra')}</span>
      <b>{showPaise(Math.abs(paise))}</b>
      {paise < 0 && <small>{t('extraNote')}</small>}
    </p>
  );
}

/** "Money received" on a client's page: one receipt in a pop-up, with the effect on what is left shown as it is typed. */
export function ReceiveMoney({ name, firm, total, received, balance, lastBill, accounts, lastAccount, today, save }: {
  name: string;
  firm: string;
  total: number;
  received: number;
  balance: number;
  /** What the newest bill came to after the client's cuts, offered as a one-tap amount. */
  lastBill?: number;
  accounts: Choice[];
  lastAccount?: string | null;
  today: string;
  save: (rows: { id: string; cells: Record<string, string> }[]) => Promise<Record<string, Saved | FormState>>;
}) {
  const t = useTranslations();
  const dialog = useRef<HTMLDialogElement>(null);
  const amountBox = useRef<HTMLInputElement>(null);
  // Kept per receipt, so a retry after a lost connection cannot save it twice.
  const rowId = useRef('');
  const usual = accounts.some((a) => a.value === lastAccount) ? lastAccount! : accounts.length === 1 ? accounts[0]!.value : '';

  const [text, setText] = useState('');
  const [account, setAccount] = useState(usual);
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [savedSerial, setSavedSerial] = useState<string | null>(null);
  const [pending, startSaving] = useTransition();

  const paise = toPaise(text);
  const yesterday = dayBefore(today);

  const startNext = () => {
    rowId.current = '';
    setText('');
    setReference('');
    setNarration('');
    setFailed(null);
    setSavedSerial(null);
  };
  const open = () => {
    if (savedSerial) startNext();
    dialog.current?.showModal();
    amountBox.current?.focus();
  };
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
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending || paise <= 0 || !account) return;
    setFailed(null);
    rowId.current ||= crypto.randomUUID();
    const id = rowId.current;
    startSaving(async () => {
      try {
        const result = (await save([{ id, cells: { entry_date: date, amount: text, to_account_id: account, reference, narration } }]))[id]!;
        startTransition(() => {
          if ('id' in result) setSavedSerial(result.serial);
          else {
            const key = Object.values(result.errors ?? {})[0] ?? 'save_failed';
            setFailed(`${t(`errors.${key}`)}${result.detail ? ` (${result.detail})` : ''}`);
          }
        });
      } catch {
        setFailed(t('errors.save_failed'));
      }
    });
  };

  const amountChip = (key: 'full' | 'lastBill', value: number) => (
    <button type="button" className={`chip${paise === value ? ' on' : ''}`} aria-pressed={paise === value}
      onClick={() => setText(groupRupees(asRupees(value)))}>
      {t(`client.receive.${key}`, { amount: showPaise(value) })}
    </button>
  );
  const dateChip = (label: string, value: string) => (
    <button type="button" className={`chip${date === value ? ' on' : ''}`} aria-pressed={date === value} onClick={() => setDate(value)}>
      {label}
    </button>
  );
  const chosen = accounts.find((a) => a.value === account);

  return (
    <div className="quick-add">
      <div className="quick-buttons">
        <button type="button" className="btn big" aria-haspopup="dialog" onClick={open}>
          <Icon name="receive" /> {t('client.receive.button')}
        </button>
      </div>
      {/* Esc closes it, and so does a click on the dimmed page; what was typed stays for when it opens again. */}
      <dialog ref={dialog} className="card quick-dialog rcv" aria-label={t('client.receive.title', { name })}
        onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <div className="quick-card-head">
          <div>
            <h2>{t('client.receive.title', { name })}</h2>
            <p className="rcv-firm">{t('client.receive.intoBooks', { firm })}</p>
          </div>
          <button type="button" className="btn ghost small" onClick={() => dialog.current?.close()}>{t('quick.close')}</button>
        </div>

        <form onSubmit={submit} className="rcv-form">
          {savedSerial ? (
            <div className="rcv-done" role="status">
              <span className="rcv-tick"><Icon name="check" size={30} /></span>
              <p className="rcv-done-amount">{t('client.receive.savedAmount', { amount: showPaise(paise) })}</p>
              <p className="rcv-done-line">
                {t('client.receive.savedLine', { account: chosen?.label ?? '', serial: savedSerial })}
              </p>
            </div>
          ) : (
            <>
              <Left paise={balance} />
              <label className="rcv-amount">
                <span className="sr-only">{t('party.amount')}</span>
                <span className="rcv-rupee" aria-hidden="true">₹</span>
                <input ref={amountBox} autoFocus type="text" inputMode="decimal" autoComplete="off" placeholder="0" required
                  style={{ width: `${Math.max(text.length, 1) + 0.5}ch` }}
                  value={text} onChange={(e) => type(e.target)} />
              </label>
              <p className="rcv-words">{paise > 0 ? rupeesInWords(paise) : t('client.receive.typeAmount')}</p>
              {balance > 0 && (
                <div className="rcv-chips">
                  {amountChip('full', balance)}
                  {/* Only below what is left: a bigger bill would be one tap away from recording extra received. */}
                  {lastBill !== undefined && lastBill > 0 && lastBill < balance && amountChip('lastBill', lastBill)}
                </div>
              )}
            </>
          )}

          {total > 0 && <Meter total={total} received={received} now={savedSerial ? 0 : paise} />}
          {savedSerial
            ? <Left paise={balance} />
            : paise > 0 && <Left paise={roundOffSmall(balance - paise)} label={t('client.receive.after')} />}

          {savedSerial ? (
            <div className="rcv-actions">
              <button type="button" className="btn ghost big" onClick={startNext}>{t('client.receive.another')}</button>
              <button type="button" className="btn big" onClick={() => dialog.current?.close()}>{t('client.receive.done')}</button>
            </div>
          ) : (
            <>
              <fieldset className="rcv-group">
                <legend>{t('client.receivedIn')}</legend>
                {accounts.length === 0 ? (
                  <p className="banner bad">
                    {t('party.needAccount')} <Link href="/masters/money-accounts" className="underline">{t('party.goSetup')}</Link>
                  </p>
                ) : (
                  <div className="rcv-tiles">
                    {accounts.map((a) => (
                      <label key={a.value} className={`rcv-tile${account === a.value ? ' on' : ''}`}>
                        <input type="radio" name="to_account_id" value={a.value} required checked={account === a.value}
                          onChange={() => setAccount(a.value)} />
                        <Icon name={a.kind === 'bank' ? 'bank' : 'receive'} />
                        <span>{a.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>

              <fieldset className="rcv-group">
                <legend>{t('client.receiptDate')}</legend>
                <div className="rcv-dates">
                  {dateChip(t('client.receive.today'), today)}
                  {dateChip(t('client.receive.yesterday'), yesterday)}
                  <input type="date" required aria-label={t('client.receiptDate')} value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </fieldset>

              <div className="rcv-notes">
                <label>
                  <span>{t('party.reference')} <span className="optional">{t('common.optional')}</span></span>
                  <input type="text" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} />
                </label>
                <label>
                  <span>{t('party.remarks')} <span className="optional">{t('common.optional')}</span></span>
                  <input type="text" autoComplete="off" value={narration} onChange={(e) => setNarration(e.target.value)} />
                </label>
              </div>

              {failed && <p role="alert" className="error form-error">{failed}</p>}
              <button type="submit" className="btn big rcv-save" disabled={pending || paise <= 0 || !account}>
                {pending ? '…' : paise > 0 ? t('client.receive.save', { amount: showPaise(paise) }) : t('client.receive.typeAmount')}
              </button>
            </>
          )}
        </form>
      </dialog>
    </div>
  );
}
