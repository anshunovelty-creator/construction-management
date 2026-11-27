'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, startTransition, useEffect, useRef, useState, useTransition } from 'react';
import { AccountOptions } from '@/components/account-options';
import { asRupees, toPaise, type FormState } from '@/components/form';
import { Icon } from '@/components/icons';
import { AmountBox, DateBox } from '@/components/money-boxes';
import { amountDoubts } from '@/lib/doubts';
import type { Choice } from '@/lib/masters/registry';
import { groupRupees, roundOffSmall, showPaise } from '@/lib/money';

type Saved = { id: string; serial: string };
/** Whose page it is on: a client's (money received) or a party's (money paid). */
type Side = 'client' | 'party';
/** A bank or cash account to pay from or receive in; with its balance, the pop-up shows what it holds before and after. */
export type PayAccount = Choice & { balance?: number };

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

/**
 * Says what is left in words and colour. A client: green still to come, red extra received. A party: red still to
 * pay, green extra paid (with its minus sign).
 */
function Left({ paise, label, side, firm }: { paise: number; label?: string; side: Side; firm?: boolean }) {
  const t = useTranslations(side);
  const list = useTranslations('payList');
  if (paise === 0) return <p className="rcv-left done"><span>{t('nothingLeft')}</span></p>;
  const green = side === 'client' ? paise > 0 : paise < 0;
  return (
    <p className={`rcv-left ${green ? 'plus' : 'minus'}`}>
      <span>{paise > 0 ? (label ?? t('balance')) : firm ? list(`${side}.firmExtra`) : t('statuses.extra')}</span>
      <b>{showPaise(side === 'client' || firm ? Math.abs(paise) : paise)}</b>
      {paise < 0 && !firm && <small>{t('extraNote')}</small>}
    </p>
  );
}

/**
 * "Money received" on a client's page, or "Pay" on a party's: one receipt or payment in a pop-up, with the effect on
 * what is left shown as it is typed.
 */
export function ReceiveMoney({ side = 'client', name, firm, total, received, balance, lastBill, accounts, lastAccount, today, save, onClose, other }: {
  side?: Side;
  name: string;
  firm: string;
  total: number;
  received: number;
  balance: number;
  /** What the newest bill came to after the client's cuts, offered as a one-tap amount. */
  lastBill?: number;
  accounts: PayAccount[];
  lastAccount?: string | null;
  today: string;
  save: (rows: { id: string; cells: Record<string, string> }[]) => Promise<Record<string, Saved | FormState>>;
  /** Opened from a list (the Bankbook's): no button of its own, open from the start, and closing it goes back to the list. */
  onClose?: () => void;
  /** Another of our firms: its own bank or cash is asked too, as the money lands in both books. */
  other?: { name: string; accounts: { id: string; name: string; kind: string; balance: number }[] };
}) {
  const t = useTranslations();
  const dialog = useRef<HTMLDialogElement>(null);
  const amountBox = useRef<HTMLInputElement>(null);
  // Kept per receipt, so a retry after a lost connection cannot save it twice.
  const rowId = useRef('');
  const usual = accounts.some((a) => a.value === lastAccount) ? lastAccount! : accounts.length === 1 ? accounts[0]!.value : '';

  const [text, setText] = useState('');
  const [account, setAccount] = useState(usual);
  // Bank or cash is asked first, then which one (picked by itself when there is only one).
  const isBank = (a: PayAccount) => a.kind === 'bank';
  const [way, setWay] = useState(usual ? (isBank(accounts.find((a) => a.value === usual)!) ? 'bank' : 'cash') : '');
  const ofWay = (w: string) => accounts.filter((a) => isBank(a) === (w === 'bank'));
  const ways = ['bank', 'cash'].filter((w) => ofWay(w).length > 0);
  const shown = ways.length === 1 ? accounts : way ? ofWay(way) : [];
  const pickWay = (w: string) => {
    setWay(w);
    if (!ofWay(w).some((a) => a.value === account)) setAccount(ofWay(w).length === 1 ? ofWay(w)[0]!.value : '');
  };
  const [otherAccount, setOtherAccount] = useState(other?.accounts.length === 1 ? other.accounts[0]!.id : '');
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  // What the bank keeps on top when it sends a party's money (owner decision 2026-11-27).
  const [charges, setCharges] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  // Asked before saving: it looks like one already there, or the amount looks wrong. Saving anyway answers it.
  // The answer is only for what was asked: anything changed is asked about again.
  const [asking, setAsking] = useState<{ about: 'repeat' | 'doubt'; of: string } | null>(null);
  const [savedSerial, setSavedSerial] = useState<string | null>(null);
  const [pending, startSaving] = useTransition();

  const paise = toPaise(text);
  const ready = paise > 0 && Boolean(account) && (!other || Boolean(otherAccount));
  const listed = onClose !== undefined;
  useEffect(() => {
    if (!listed || dialog.current?.open) return;
    dialog.current?.showModal();
    amountBox.current?.focus();
  }, [listed]);

  const startNext = () => {
    rowId.current = '';
    setText('');
    setReference('');
    setNarration('');
    setCharges('');
    setFailed(null);
    setSavedSerial(null);
  };
  const open = () => {
    if (savedSerial) startNext();
    dialog.current?.showModal();
    amountBox.current?.focus();
  };
  const asked = `${paise}|${account}|${charges}`;
  const ask = asking?.of === asked ? asking.about : null;
  const submit = (e: React.SyntheticEvent, answered: 'repeat' | 'doubt' | null = null) => {
    e.preventDefault();
    if (!ready || pending) return;
    setFailed(null);
    setAsking(null);
    if (!answered) {
      const account = chosen?.kind === 'bank' && side === 'party' ? chosen : undefined;
      const found = amountDoubts({ paise, left: other ? undefined : balance, before: account?.balance, after: account && after });
      if (found.length > 0) {
        setAsking({ about: 'doubt', of: asked });
        setFailed([...found.map((d) => (d === 'more' ? t('doubts.more', { amount: showPaise(paise - balance), left: showPaise(balance) })
          : t('doubts.overdrawn', { account: chosen!.label, amount: showPaise(after) }))), t('doubts.check')].join(' '));
        return;
      }
    }
    const anyway = answered === 'repeat';
    rowId.current ||= crypto.randomUUID();
    const id = rowId.current;
    startSaving(async () => {
      try {
        const result = (await save([{ id, cells: { entry_date: date, amount: text, [side === 'client' ? 'to_account_id' : 'from_account_id']: account, reference, narration, ...(chargeable && { charges }), ...(other && { other_account_id: otherAccount }), ...(anyway ? {} : { check: '1' }) } }]))[id]!;
        startTransition(() => {
          if ('id' in result) setSavedSerial(result.serial);
          else {
            const key = Object.values(result.errors ?? {})[0] ?? 'save_failed';
            setAsking(key === 'maybe_repeat' ? { about: 'repeat', of: asked } : null);
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
      {t(`${side}.receive.${key}`, { amount: showPaise(value) })}
    </button>
  );
  const chosen = accounts.find((a) => a.value === account);
  const chargeable = side === 'party' && !other && chosen?.kind === 'bank';
  const chargePaise = chargeable ? toPaise(charges) : 0;
  const after = chosen?.balance === undefined ? 0 : chosen.balance + (side === 'client' ? paise : -paise - chargePaise);

  const button = !listed && (
    <button type="button" className="btn big" aria-haspopup="dialog" onClick={open}>
      <Icon name={side === 'client' ? 'receive' : 'payOut'} /> {t(`${side}.receive.button`)}
    </button>
  );
  // A party's Pay button sits beside "+ Add bill", inside that row; a client's has a row of its own.
  const Wrap = side === 'client' && !listed ? 'div' : Fragment;
  return (
    <Wrap {...(Wrap === 'div' && { className: 'quick-add' })}>
      {Wrap === 'div' ? <div className="quick-buttons">{button}</div> : button}
      {/* Esc closes it, and so does a click on the dimmed page; what was typed stays for when it opens again. */}
      <dialog ref={dialog} className="card quick-dialog rcv" aria-label={t(`${side}.receive.title`, { name })} onClose={onClose}
        onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <div className="quick-card-head">
          <div>
            <h2>{t(`${side}.receive.title`, { name })}</h2>
            <p className="rcv-firm">{other ? t('between.bothBooks') : t(`${side}.receive.intoBooks`, { firm })}</p>
          </div>
          <button type="button" className="btn ghost small" onClick={() => dialog.current?.close()}>{t('quick.close')}</button>
        </div>

        <form onSubmit={(e) => submit(e)} className="rcv-form">
          {savedSerial ? (
            <div className="rcv-done" role="status">
              <span className="rcv-tick"><Icon name="check" size={30} /></span>
              <p className="rcv-done-amount">{t(`${side}.receive.savedAmount`, { amount: showPaise(paise) })}</p>
              <p className="rcv-done-line">
                {t(`${side}.receive.savedLine`, { account: chosen?.label ?? '', serial: savedSerial })}
              </p>
            </div>
          ) : (
            <>
              <Left paise={balance} side={side} firm={Boolean(other)} />
              <AmountBox ref={amountBox} text={text} setText={setText} label={t('party.amount')} />
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
            ? <Left paise={balance} side={side} firm={Boolean(other)} />
            : paise > 0 && <Left paise={roundOffSmall(balance - paise)} label={t('client.receive.after')} side={side} firm={Boolean(other)} />}

          {savedSerial ? (
            <div className="rcv-actions">
              <button type="button" className="btn ghost big" onClick={startNext}>{t('client.receive.another')}</button>
              <button type="button" className="btn big" onClick={() => dialog.current?.close()}>{t(listed ? 'payList.back' : 'client.receive.done')}</button>
            </div>
          ) : (
            <>
              <fieldset className="rcv-group">
                <legend>{t(side === 'client' ? 'client.receivedIn' : 'party.paidFrom')}</legend>
                {accounts.length === 0 ? (
                  <p className="banner bad">
                    {t('party.needAccount')} <Link href="/masters/money-accounts" className="underline">{t('party.goSetup')}</Link>
                  </p>
                ) : (
                  <>
                  {ways.length > 1 && (
                    <div className="rcv-tiles rcv-ways">
                      {ways.map((w) => (
                        <label key={w} className={`rcv-tile${way === w ? ' on' : ''}`}>
                          <input type="radio" name="way" value={w} required checked={way === w} onChange={() => pickWay(w)} />
                          <Icon name={w === 'bank' ? 'bank' : 'receive'} />
                          <span>{t(`cash.${w}`)}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="rcv-tiles">
                    {shown.map((a) => (
                      <label key={a.value} className={`rcv-tile${account === a.value ? ' on' : ''}`}>
                        <input type="radio" name="to_account_id" value={a.value} required checked={account === a.value}
                          onChange={() => setAccount(a.value)} />
                        <Icon name={a.kind === 'bank' ? 'bank' : 'receive'} />
                        <span>{a.label}</span>
                      </label>
                    ))}
                  </div>
                  </>
                )}
                {chosen?.balance !== undefined && (
                  <p className="hint">{chosen.label}: {showPaise(chosen.balance)}{paise > 0 && <> → <b className={after < 0 ? 'minus' : undefined}>{showPaise(after)}</b></>}</p>
                )}
              </fieldset>

              {chargeable && (
                <div className="field">
                  <label>
                    <span>{t('fields.charges')} <span className="optional">{t('common.optional')}</span></span>
                    <input type="text" inputMode="decimal" autoComplete="off" value={charges} onChange={(e) => setCharges(e.target.value)} />
                  </label>
                  {chargePaise > 0 && paise > 0 && <p className="hint">{t('party.withCharges', { amount: showPaise(paise), charges: showPaise(chargePaise), total: showPaise(paise + chargePaise) })}</p>}
                </div>
              )}
              {other && (
                <div className="field">
                  <label>{t(side === 'client' ? 'between.outOf' : 'between.into', { firm: other.name })}
                    <select required value={otherAccount} onChange={(e) => setOtherAccount(e.target.value)}>
                      <option value="">{t('bankbook.popup.pick')}</option>
                      <AccountOptions accounts={other.accounts} />
                    </select>
                  </label>
                </div>
              )}
              <DateBox date={date} setDate={setDate} today={today} label={t(side === 'client' ? 'client.receiptDate' : 'party.payDate')} />

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
              {ask && <button type="button" className="btn ghost big" disabled={pending} onClick={(e) => submit(e, ask)}>{t(ask === 'repeat' ? 'repeat.anyway' : 'doubts.anyway')}</button>}
              <button type="submit" className="btn big rcv-save" disabled={pending || !ready}>
                {pending ? '…' : paise > 0 ? t(`${side}.receive.save`, { amount: showPaise(paise) }) : t('client.receive.typeAmount')}
              </button>
            </>
          )}
        </form>
      </dialog>
    </Wrap>
  );
}
