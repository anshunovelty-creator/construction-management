'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition, useRef, useState, useTransition } from 'react';
import { AccountOptions } from '@/components/account-options';
import { toPaise, type FormState } from '@/components/form';
import { Icon, type IconName } from '@/components/icons';
import { AmountBox, DateBox } from '@/components/money-boxes';
import { SearchSelect } from '@/components/search-select';
import { lastMonth } from '@/lib/wages';
import { IN_REASONS, OUT_REASONS, reasonOf } from '@/lib/ledger/posting/other';
import { amountDoubts } from '@/lib/doubts';
import { groupRupees, showPaise } from '@/lib/money';

type Saved = { id: string; serial: string };
/** Money in, money out, or a move between two of the firm's accounts: any two, cash taken out of a bank, or cash put in one. */
export type MoneyMode = 'in' | 'out' | 'move' | 'withdraw' | 'deposit';
export interface PopupAccount { id: string; name: string; kind: string; balance: number }
/** A client or party, with what is left: to receive from a client, to pay a party. Below zero is extra. */
export interface PopupPerson { id: string; name: string; left: number }

/** Why the money moved: each saves one kind of entry. */
type Why = 'client' | 'party' | 'owner' | 'other' | 'unknown' | 'move';
const SLUG: Record<Why, string> = {
  client: 'client-receipt', party: 'pay-vendor', owner: 'owner-money', other: 'other-money', unknown: 'not-yet-known', move: 'move-money',
};
const ICON: Record<MoneyMode, IconName> = { in: 'receive', out: 'payOut', move: 'arrowRight', withdraw: 'payOut', deposit: 'bank' };

/**
 * A bankbook's pop-up for one account: money in, money out or a move. With `fixed` it sorts out money not yet known:
 * the account, amount and date are already there, and only who and why are asked.
 */
export function MoneyPopup({ mode, firm, account, accounts, people, others = [], owner, today, fixed, listed = false, button, save }: {
  mode: MoneyMode;
  firm: { id: string; name: string };
  /** The account it was opened from; '' on the Bankbook's own page, where both accounts of a move are asked. */
  account: string;
  accounts: PopupAccount[];
  /** Clients for money in, parties for money out. */
  people: PopupPerson[];
  /** The other list: parties on money in (one may give money back), clients on money out (a cheque returned). */
  others?: PopupPerson[];
  owner: boolean;
  today: string;
  fixed?: { paise: number; date: string; note: string };
  /** Beside the Pay or Receive list, which already has the parties and clients: only the other reasons. */
  listed?: boolean;
  button?: string;
  save: (entryId: string, slug: string, firmId: string, cells: Record<string, string>) => Promise<Saved | FormState>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const entryId = useRef('');
  const person: Why = mode === 'in' ? 'client' : 'party';
  const moves = mode !== 'in' && mode !== 'out';
  // Cash leaves a bank for a cash account, or the other way round; any other move is free.
  const fits = (end: 'from' | 'to') => accounts.filter((a) => mode === 'move' || !moves || (a.kind === 'bank') === ((mode === 'withdraw') === (end === 'from')));
  const start = (end: 'from' | 'to') => {
    const of = fits(end);
    if (!moves) return (mode === 'in') === (end === 'to') ? account : '';
    if (of.some((a) => a.id === account) && (mode !== 'move' || end === 'from')) return account;
    return mode !== 'move' && of.length === 1 ? of[0]!.id : '';
  };
  const whys: Why[] = moves ? ['move'] : [...(listed ? [] : [person]), 'other', ...(owner ? ['owner' as const] : []), fixed ? 'move' : 'unknown'];

  const [why, setWhy] = useState<Why>(whys[0]!);
  const [text, setText] = useState(fixed ? groupRupees(String(fixed.paise / 100)) : '');
  const [date, setDate] = useState(fixed?.date ?? today);
  const [who, setWho] = useState('');
  const [from, setFrom] = useState(start('from'));
  const [to, setTo] = useState(start('to'));
  const [reason, setReason] = useState('');
  const [month, setMonth] = useState(lastMonth(today.slice(0, 7)));
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState(fixed?.note ?? '');
  const [failed, setFailed] = useState<string | null>(null);
  // Asked before saving: it looks like one already there, or the amount looks wrong. Saving anyway answers it.
  // The answer is only for what was asked: anything changed is asked about again.
  const [asking, setAsking] = useState<{ about: 'repeat' | 'doubt'; of: string } | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [pending, startSaving] = useTransition();

  const paise = fixed?.paise ?? toPaise(text);
  const here = accounts.find((a) => a.id === account);
  const chosen = people.find((p) => p.id === who);
  const picked = reasonOf(reason);
  const withWhom = (picked?.party === 'vendor') === (mode === 'out') ? people : others;
  const ready = paise > 0 && (why !== 'other' || Boolean(picked && (!picked.party || who) && (!picked.note || narration.trim()))) && (why === 'move' ? Boolean(from && to && from !== to) : why === person ? Boolean(who) : why !== 'unknown' || narration.trim() !== '');

  const startNext = () => {
    entryId.current = '';
    setText('');
    setReference('');
    setNarration('');
    setWho('');
    setFailed(null);
    setSaved(null);
  };
  const open = () => {
    if (saved) startNext();
    dialog.current?.showModal();
  };
  const asked = `${paise}|${who}|${why}|${from}|${to}`;
  const ask = asking?.of === asked ? asking.about : null;
  const submit = (e: React.SyntheticEvent, answered: 'repeat' | 'doubt' | null = null) => {
    e.preventDefault();
    if (pending || !ready) return;
    setFailed(null);
    setAsking(null);
    if (!answered) {
      // Money being sorted out has moved already, so only what is left to the person is compared.
      const leaves = fixed || mode === 'in' ? undefined : accounts.find((a) => a.id === (why === 'move' ? from : account));
      const bank = leaves?.kind === 'bank' ? leaves : undefined;
      const left = why === person ? chosen?.left : undefined;
      const found = amountDoubts({ paise, left, before: bank?.balance, after: bank && bank.balance - paise });
      if (found.length > 0) {
        setAsking({ about: 'doubt', of: asked });
        setFailed([...found.map((d) => (d === 'more' ? t('doubts.more', { amount: showPaise(paise - left!), left: showPaise(left!) })
          : t('doubts.overdrawn', { account: bank!.name, amount: showPaise(bank!.balance - paise) }))), t('doubts.check')].join(' '));
        return;
      }
    }
    const anyway = answered === 'repeat';
    // Kept per entry, so a retry after a lost connection cannot save it twice.
    entryId.current ||= crypto.randomUUID();
    const cells: Record<string, string> = { entry_date: date, amount: text, reference, narration, ...(anyway ? {} : { check: '1' }) };
    if (why === 'client') Object.assign(cells, { client_id: who, to_account_id: account });
    else if (why === 'party') Object.assign(cells, { vendor_id: who, from_account_id: account });
    else if (why === 'other') Object.assign(cells, { reason, account_id: account, person_id: picked?.party ? who : '', month: picked?.month ? month : '' });
    else if (why === 'move') Object.assign(cells, { from_account_id: from, to_account_id: to });
    else Object.assign(cells, { direction: mode, account_id: account });
    startSaving(async () => {
      let result: Saved | FormState;
      try {
        result = await save(entryId.current, SLUG[why], firm.id, cells);
      } catch {
        result = { errors: { _form: 'save_failed' } };
      }
      startTransition(() => {
        // Sorted out: on to the entry that took its place.
        if ('id' in result) return fixed ? router.replace(`/entries/${result.id}?saved=1`) : setSaved(result);
        const key = Object.values(result.errors ?? {})[0] ?? 'save_failed';
        setAsking(key === 'maybe_repeat' ? { about: 'repeat', of: asked } : null);
        setFailed(`${t(`errors.${key}`)}${result.detail ? ` (${result.detail})` : ''}`);
      });
    });
  };

  const title = t(`bankbook.popup.${fixed ? 'sortOut' : mode}`, { account: here?.name ?? '' });
  // Each account of a move, with what it holds before and after.
  const pick = (label: string, end: 'from' | 'to', value: string, set: (id: string) => void, sign: 1 | -1, other: string) => {
    const a = accounts.find((x) => x.id === value);
    const locked = Boolean(fixed) && value === account;
    return (
      <div className="field">
        <label>{label}
          <select required value={value} disabled={locked} onChange={(e) => set(e.target.value)}>
            <option value="">{t('bankbook.popup.pick')}</option>
            <AccountOptions accounts={fits(end).filter((x) => x.id !== other).map(({ id, name, kind }) => ({ id, name, kind }))} />
          </select>
        </label>
        {a && !fixed && (
          <p className="hint">{showPaise(a.balance)}{paise > 0 && !saved && <> → <b className={a.balance + sign * paise < 0 ? 'minus' : undefined}>{showPaise(a.balance + sign * paise)}</b></>}</p>
        )}
      </div>
    );
  };

  return (
    <>
      <button type="button" className={`btn big${(mode === 'in' || fixed) && !listed ? '' : ' ghost'}`} aria-haspopup="dialog" onClick={open}>
        <Icon name={ICON[mode]} /> {button ?? t(`bankbook.buttons.${mode}`)}
      </button>
      <dialog ref={dialog} className="card quick-dialog rcv" aria-label={title} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <div className="quick-card-head">
          <div>
            <h2>{title}</h2>
            <p className="rcv-firm">{firm.name}</p>
          </div>
          <button type="button" className="btn ghost small" onClick={() => dialog.current?.close()}>{t('quick.close')}</button>
        </div>
        {saved ? (
          <div className="rcv-form">
            <div className="rcv-done" role="status">
              <span className="rcv-tick"><Icon name="check" size={30} /></span>
              <p className="rcv-done-amount">{showPaise(paise)}</p>
              <p className="rcv-done-line">{t('entries.saved', { serial: saved.serial })}</p>
            </div>
            <div className="rcv-actions">
              <button type="button" className="btn ghost big" onClick={startNext}>{t('client.receive.another')}</button>
              <button type="button" className="btn big" onClick={() => dialog.current?.close()}>{t('client.receive.done')}</button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => submit(e)} className="rcv-form">
            {fixed
              ? <p className={`rcv-done-amount ${mode === 'out' ? 'minus' : ''}`}>{showPaise(fixed.paise)}</p>
              : <AmountBox text={text} setText={setText} label={t('party.amount')} />}
            {whys.length > 1 && (
              <fieldset className="rcv-group">
                <legend>{t(`bankbook.popup.why.${mode}`)}</legend>
                <div className="rcv-tiles">
                  {whys.map((w) => (
                    <label key={w} className={`rcv-tile${why === w ? ' on' : ''}`}>
                      <input type="radio" name={`why-${mode}`} checked={why === w} onChange={() => { setWhy(w); setWho(''); }} />
                      <span>{t(`bankbook.popup.${mode}Why.${w}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {why === person && !moves && (
              <div className="field">
                <label htmlFor={`who-${mode}`}>{t(`bankbook.popup.who.${mode}`)}</label>
                <SearchSelect id={`who-${mode}`} value={who} onChange={setWho} required options={people.map((p) => ({ value: p.id, label: p.name }))} />
                {chosen && chosen.left > 0 && <p className={`hint ${mode === 'in' ? 'plus' : 'minus'}`}>{t(`bankbook.popup.left.${mode}`, { amount: showPaise(chosen.left) })}</p>}
              </div>
            )}
            {why === 'other' && !moves && (
              <div className="rcv-notes">
                <div className="field">
                  <label>{t('bankbook.popup.reason')}
                    <select required value={reason} onChange={(e) => { setReason(e.target.value); setWho(''); }}>
                      <option value="">{t('bankbook.popup.pick')}</option>
                      {(mode === 'in' ? IN_REASONS : OUT_REASONS).map((r) => <option key={r} value={r}>{t(`options.money_reason.${r}`)}</option>)}
                    </select>
                  </label>
                </div>
                {picked?.month && <div className="field"><label>{t('tax.month')}<input type="month" required value={month} max={today.slice(0, 7)} onChange={(e) => setMonth(e.target.value)} /></label></div>}
                {picked?.party && (
                  <div className="field">
                    <label htmlFor={`with-${mode}`}>{t(picked.party === 'client' ? 'bankbook.popup.who.in' : 'bankbook.popup.who.out')}</label>
                    <SearchSelect key={picked.party} id={`with-${mode}`} value={who} onChange={setWho} required options={withWhom.map((p) => ({ value: p.id, label: p.name }))} />
                  </div>
                )}
              </div>
            )}
            {moves && mode !== 'move' && (['from', 'to'] as const).some((end) => fits(end).length === 0) && (
              <p className="banner bad">{t(fits(mode === 'withdraw' ? 'to' : 'from').length === 0 ? 'cash.noCash' : 'cash.noBank')} <Link href="/masters/money-accounts" className="underline">{t('party.goSetup')}</Link></p>
            )}
            {why === 'move' && (
              <div className="rcv-notes">
                {pick(t(mode === 'withdraw' ? 'cash.fromBank' : mode === 'deposit' ? 'cash.fromCash' : 'fields.from_account_id'), 'from', from, setFrom, -1, to)}
                {pick(t(mode === 'withdraw' ? 'cash.intoCash' : mode === 'deposit' ? 'cash.intoBank' : 'fields.to_account_id'), 'to', to, setTo, 1, from)}
              </div>
            )}
            {!fixed && <DateBox date={date} setDate={setDate} today={today} label={t('fields.entry_date')} />}
            <div className="rcv-notes">
              <label>
                <span>{t('party.reference')} <span className="optional">{t('common.optional')}</span></span>
                <input type="text" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
              <label>
                <span>{why === 'unknown' ? t('bankbook.popup.bankSays') : <>{t('party.remarks')} <span className="optional">{t('common.optional')}</span></>}</span>
                <input type="text" autoComplete="off" required={why === 'unknown' || Boolean(why === 'other' && picked?.note)} value={narration} onChange={(e) => setNarration(e.target.value)} />
              </label>
            </div>
            {failed && <p role="alert" className="error form-error">{failed}</p>}
            {ask && <button type="button" className="btn ghost big" disabled={pending} onClick={(e) => submit(e, ask)}>{t(ask === 'repeat' ? 'repeat.anyway' : 'doubts.anyway')}</button>}
            <button type="submit" className="btn big rcv-save" disabled={pending || !ready}>
              {pending ? '…' : paise > 0 ? t('bankbook.popup.save', { amount: showPaise(paise) }) : t('client.receive.typeAmount')}
            </button>
          </form>
        )}
      </dialog>
    </>
  );
}
