'use client';

import { useTranslations } from 'next-intl';
import { startTransition, useRef, useState, useTransition } from 'react';
import { AccountOptions } from '@/components/account-options';
import { toPaise } from '@/components/form';
import { DateBox } from '@/components/money-boxes';
import { amountDoubts } from '@/lib/doubts';
import { groupRupees, showPaise } from '@/lib/money';
import { rupeesInWords } from '@/lib/words';
import type { PayInput, PayKind, PayResult } from '@/app/(app)/pay/actions';

export interface PayRow { id: string; name: string; note?: string; left: number }

/** Pays one person or many from one account, as one line in its bankbook. What is left to each is beside their box. */
export function PayPeople({ rows, accounts, today, save, single = false }: {
  rows: PayRow[];
  accounts: { id: string; name: string; kind: string; balance: number }[];
  today: string;
  save: (input: PayInput) => Promise<PayResult>;
  single?: boolean;
}) {
  const t = useTranslations();
  const entryId = useRef('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [account, setAccount] = useState(accounts.length === 1 ? accounts[0]!.id : '');
  const [kind, setKind] = useState<PayKind>('payment');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);
  // Asked before saving: someone looks paid already, or an amount looks wrong. Saving anyway answers it.
  // The answer is only for what was asked: anything changed is asked about again.
  const [asking, setAsking] = useState<{ about: 'repeat' | 'doubt'; of: string } | null>(null);
  const [pending, start] = useTransition();
  const total = rows.reduce((s, r) => s + toPaise(amounts[r.id] ?? ''), 0);
  const people = rows.filter((r) => toPaise(amounts[r.id] ?? '') > 0).length;
  const chosen = accounts.find((a) => a.id === account);
  const after = chosen ? chosen.balance + (kind === 'returned' ? total : -total) : 0;

  const asked = `${JSON.stringify(amounts)}|${account}|${kind}`;
  const ask = asking?.of === asked ? asking.about : null;
  const submit = (e: React.SyntheticEvent, answered: 'repeat' | 'doubt' | null = null) => {
    e.preventDefault();
    if (pending || total <= 0 || !account) return;
    setMessage(null);
    setAsking(null);
    if (!answered && kind !== 'returned') {
      const bank = chosen?.kind === 'bank' ? chosen : undefined;
      const found = [
        // An advance is meant to be ahead of what is owed.
        ...(kind === 'payment' ? rows.flatMap((r) => {
          const paise = toPaise(amounts[r.id] ?? '');
          return amountDoubts({ paise, left: r.left }).map(() => t('doubts.morePerson', { name: r.name, amount: showPaise(paise - r.left), left: showPaise(r.left) }));
        }) : []),
        ...amountDoubts({ paise: total, before: bank?.balance, after: bank && after }).map(() => t('doubts.overdrawn', { account: bank!.name, amount: showPaise(after) })),
      ];
      if (found.length > 0) {
        setAsking({ about: 'doubt', of: asked });
        setMessage({ bad: true, text: [...found.slice(0, 5), t('doubts.check')].join(' ') });
        return;
      }
    }
    const anyway = answered === 'repeat';
    entryId.current ||= crypto.randomUUID();
    start(async () => {
      let result: PayResult;
      try {
        result = await save({ entryId: entryId.current, accountId: account, date, kind, note, anyway, lines: rows.flatMap((r) => (toPaise(amounts[r.id] ?? '') > 0 ? [{ id: r.id, amount: amounts[r.id]! }] : [])) });
      } catch {
        result = { error: 'not_saved' };
      }
      startTransition(() => {
        if ('serial' in result) {
          entryId.current = '';
          setAmounts({});
          setNote('');
          setMessage({ bad: false, text: t('pay.saved', { amount: showPaise(total), serial: result.serial }) });
        } else {
          setAsking(result.error === 'paid_twice' ? { about: 'repeat', of: asked } : null);
          setMessage({ bad: true, text: `${t(`labour.errors.${result.error}`)}${result.detail ? ` (${result.detail})` : ''}` });
        }
      });
    });
  };

  if (accounts.length === 0) return <p className="banner bad">{t('pay.noAccount')}</p>;
  return (
    <form onSubmit={(e) => submit(e)} className="card pay-people">
      <div className="pay-head">
        <label className="field"><span>{t('pay.from')}</span>
          <select required value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">{t('bankbook.popup.pick')}</option>
            <AccountOptions accounts={accounts} />
          </select>
        </label>
        <label className="field"><span>{t('labour.moneyKind')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as PayKind)}>
            <option value="payment">{t('labour.kinds.payment')}</option>
            <option value="advance">{t('labour.kinds.advance')}</option>
            <option value="returned">{t('labour.kinds.returned')}</option>
          </select>
        </label>
        <label className="field"><span>{t('party.remarks')} <span className="optional">{t('common.optional')}</span></span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <DateBox date={date} setDate={setDate} today={today} label={t('fields.entry_date')} />
      <div className="table-wrap">
        <table className="ledger" id="pay-people">
          <thead>
            <tr><th>{t('labour.name')}</th><th className="num">{t('party.balance')}</th><th className="num">{t('labour.amount')}</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-name={r.name}>
                <td>{r.name}{r.note && <span className="muted"> · {r.note}</span>}</td>
                <td className={`num${r.left > 0 ? ' minus' : r.left < 0 ? ' plus' : ' muted'}`}>
                  {r.left > 0 ? <button type="button" className="link-button" title={t('pay.fill')} onClick={() => setAmounts((all) => ({ ...all, [r.id]: groupRupees(String(r.left / 100)) }))}>{showPaise(r.left)}</button>
                    : r.left < 0 ? `${showPaise(r.left)} ${t('labour.beforeExtra')}` : '–'}
                </td>
                <td className="num">
                  <input aria-label={`${r.name}: ${t('labour.amount')}`} inputMode="decimal" autoComplete="off" className="pay-box" value={amounts[r.id] ?? ''}
                    onChange={(e) => setAmounts((all) => ({ ...all, [r.id]: groupRupees(e.target.value) }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!single && <button type="button" className="link-button" onClick={() => setAmounts(Object.fromEntries(rows.filter((r) => r.left > 0).map((r) => [r.id, groupRupees(String(r.left / 100))])))}>{t('pay.fillAll')}</button>}
      <p className="rcv-words">{total > 0 ? <><b>{showPaise(total)}</b> · {rupeesInWords(total)}{chosen && <> · {chosen.name} → <b className={after < 0 ? 'minus' : undefined}>{showPaise(after)}</b></>}</> : t('client.receive.typeAmount')}</p>
      {message && <p role={message.bad ? 'alert' : 'status'} className={`banner${message.bad ? ' bad' : ''}`}>{message.text}</p>}
      {ask && <button type="button" className="btn ghost big" disabled={pending} onClick={(e) => submit(e, ask)}>{t(ask === 'repeat' ? 'repeat.anyway' : 'doubts.anyway')}</button>}
      <button type="submit" className="btn big" disabled={pending || total <= 0 || !account}>
        {pending ? '…' : total > 0 ? t(kind === 'returned' ? 'pay.take' : 'pay.pay', { amount: showPaise(total), count: people }) : t('client.receive.typeAmount')}
      </button>
    </form>
  );
}
