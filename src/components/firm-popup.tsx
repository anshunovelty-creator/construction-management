'use client';

import { useTranslations } from 'next-intl';
import { startTransition, useRef, useState, useTransition } from 'react';
import { AccountOptions } from '@/components/account-options';
import { toPaise, type FormState } from '@/components/form';
import { Icon } from '@/components/icons';
import { AmountBox, DateBox } from '@/components/money-boxes';
import type { PopupAccount, PopupPerson } from '@/components/money-popup';
import { SearchSelect } from '@/components/search-select';
import { COST_HEADS } from '@/lib/ledger/types';
import type { Choice } from '@/lib/masters/registry';
import { showPaise } from '@/lib/money';

type Saved = { id: string; serial: string };
export type BetweenKind = 'gave' | 'took' | 'wePaid' | 'theyPaid' | 'theyBilled' | 'weBilled' | 'rent';
/** What a bill between our firms may be for: a site's cost heads. */
const HEADS = COST_HEADS.filter((h) => h !== 'staff');
interface Side { id: string; name: string; accounts: PopupAccount[]; parties: PopupPerson[] }

/** One movement between the working firm and another of our firms, from their running account's page. */
export function FirmPopup({ us, them, sites, gstRates, tdsRates, machines, rentTo, today, save }: {
  us: Side;
  them: Side;
  sites: Choice[];
  gstRates: Choice[];
  tdsRates: Choice[];
  machines: string[];
  /** The firm a machine can be rented to here: the one of the two that does not own the machines. Null when neither does. */
  rentTo: string | null;
  today: string;
  save: (entryId: string, kind: BetweenKind, cells: Record<string, string>) => Promise<Saved | FormState>;
}) {
  const t = useTranslations();
  const dialog = useRef<HTMLDialogElement>(null);
  const entryId = useRef('');
  const kinds: BetweenKind[] = ['theyBilled', 'weBilled', 'gave', 'took', 'wePaid', 'theyPaid', ...(rentTo ? ['rent' as const] : [])];
  const [kind, setKind] = useState<BetweenKind>('theyBilled');
  const [text, setText] = useState('');
  const [date, setDate] = useState(today);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [pending, startSaving] = useTransition();
  const paise = toPaise(text);
  const set = (name: string, value: string) => setCells((c) => ({ ...c, [name]: value }));
  const payer = kind === 'gave' || kind === 'wePaid' ? us : them;
  const other = payer === us ? them : us;
  const transfer = kind === 'gave' || kind === 'took';
  const billed = kind === 'theyBilled' || kind === 'weBilled';
  const ready = paise > 0 && (billed ? Boolean(cells.site && cells.head) : kind === 'rent' ? Boolean(cells.site) : transfer ? Boolean(cells.from && cells.to) : Boolean(cells.from && cells.party));

  const pickKind = (k: BetweenKind) => {
    setKind(k);
    // The accounts and parties belong to a side, so they are asked again.
    setCells((c) => ({ reference: c.reference ?? '', narration: c.narration ?? '' }));
  };
  const startNext = () => {
    entryId.current = '';
    setText('');
    setCells({});
    setFailed(null);
    setSaved(null);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending || !ready) return;
    setFailed(null);
    entryId.current ||= crypto.randomUUID();
    startSaving(async () => {
      let result: Saved | FormState;
      try {
        result = await save(entryId.current, kind, { ...cells, amount: text, date });
      } catch {
        result = { errors: { _form: 'save_failed' } };
      }
      startTransition(() => {
        if ('id' in result) return setSaved(result);
        const key = Object.values(result.errors ?? {})[0] ?? 'save_failed';
        setFailed(`${t(`errors.${key}`)}${result.detail ? ` (${result.detail})` : ''}`);
      });
    });
  };
  const select = (name: string, label: string, options: Choice[] | PopupAccount[], required: boolean, empty = t('bankbook.popup.pick')) => (
    <div className="field">
      <label>{label}
        <select required={required} value={cells[name] ?? ''} onChange={(e) => set(name, e.target.value)}>
          <option value="">{empty}</option>
          {options.length > 0 && 'balance' in options[0]!
            ? <AccountOptions accounts={options as PopupAccount[]} />
            : (options as Choice[]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    </div>
  );
  const names = { us: us.name, them: them.name };
  const party = other.parties.find((p) => p.id === cells.party);

  return (
    <>
      <button type="button" className="btn big" aria-haspopup="dialog" onClick={() => { if (saved) startNext(); dialog.current?.showModal(); }}>
        <Icon name="plus" /> {t('between.add')}
      </button>
      <dialog ref={dialog} className="card quick-dialog rcv" aria-label={t('between.popupTitle', names)} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <div className="quick-card-head">
          <h2>{t('between.popupTitle', names)}</h2>
          <button type="button" className="btn ghost small" onClick={() => dialog.current?.close()}>{t('quick.close')}</button>
        </div>
        {saved ? (
          <div className="rcv-form">
            <div className="rcv-done" role="status">
              <span className="rcv-tick"><Icon name="check" size={30} /></span>
              <p className="rcv-done-amount">{showPaise(paise)}</p>
              <p className="rcv-done-line">{t('between.savedBoth', { serial: saved.serial })}</p>
            </div>
            <div className="rcv-actions">
              <button type="button" className="btn ghost big" onClick={startNext}>{t('client.receive.another')}</button>
              <button type="button" className="btn big" onClick={() => dialog.current?.close()}>{t('client.receive.done')}</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="rcv-form">
            <AmountBox text={text} setText={setText} label={t('party.amount')} />
            <fieldset className="rcv-group">
              <legend>{t('between.what')}</legend>
              <div className="rcv-tiles">
                {kinds.map((k) => (
                  <label key={k} className={`rcv-tile${kind === k ? ' on' : ''}`}>
                    <input type="radio" name="between-kind" checked={kind === k} onChange={() => pickKind(k)} />
                    <span>{t(`between.kinds.${k}`, names)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {billed ? (
              <>
                <div className="rcv-notes">
                  {select('site', t('between.siteOf', { firm: kind === 'weBilled' ? them.name : us.name }), sites, true)}
                  {select('head', t('between.billFor'), HEADS.map((h) => ({ value: h, label: t(`options.cost_head.${h}`) })), true)}
                </div>
                <div className="rcv-notes">
                  {select('gst', t('fields.gst_rate'), gstRates, false, t('between.none'))}
                  {select('tds', t('fields.tds_rate'), tdsRates, false, t('between.none'))}
                </div>
              </>
            ) : kind === 'rent' ? (
              <>
                <div className="rcv-notes">
                  {select('site', t('between.siteOf', { firm: rentTo === us.id ? us.name : them.name }), sites, true)}
                  {select('machine', t('between.machine'), machines.map((m) => ({ value: m, label: m })), false)}
                </div>
                <div className="rcv-notes">
                  {select('gst', t('fields.gst_rate'), gstRates, false, t('between.none'))}
                  {select('tds', t('fields.tds_rate'), tdsRates, false, t('between.none'))}
                </div>
              </>
            ) : (
              <>
                {!transfer && (
                  <div className="field">
                    <label htmlFor="between-party">{t('between.partyOf', { firm: other.name })}</label>
                    <SearchSelect key={kind} id="between-party" value={cells.party ?? ''} onChange={(v) => set('party', v)} required options={other.parties.map((p) => ({ value: p.id, label: p.name }))} />
                    {party && party.left > 0 && <p className="hint minus">{t('bankbook.popup.left.out', { amount: showPaise(party.left) })}</p>}
                  </div>
                )}
                <div className="rcv-notes">
                  {select('from', t('between.outOf', { firm: payer.name }), payer.accounts, true)}
                  {transfer && select('to', t('between.into', { firm: other.name }), other.accounts, true)}
                </div>
                {payer.accounts.find((a) => a.id === cells.from)?.kind === 'bank' && (
                  <div className="field">
                    <label>
                      <span>{t('fields.charges')} <span className="optional">{t('common.optional')}</span></span>
                      <input type="text" inputMode="decimal" autoComplete="off" value={cells.charges ?? ''} onChange={(e) => set('charges', e.target.value)} />
                    </label>
                  </div>
                )}
              </>
            )}
            <DateBox date={date} setDate={setDate} today={today} label={t('fields.entry_date')} />
            <div className="rcv-notes">
              <label>
                <span>{t('party.reference')} <span className="optional">{t('common.optional')}</span></span>
                <input type="text" autoComplete="off" value={cells.reference ?? ''} onChange={(e) => set('reference', e.target.value)} />
              </label>
              <label>
                <span>{t('party.remarks')} <span className="optional">{t('common.optional')}</span></span>
                <input type="text" autoComplete="off" value={cells.narration ?? ''} onChange={(e) => set('narration', e.target.value)} />
              </label>
            </div>
            {failed && <p role="alert" className="error form-error">{failed}</p>}
            <button type="submit" className="btn big rcv-save" disabled={pending || !ready}>
              {pending ? '…' : paise > 0 ? t('bankbook.popup.save', { amount: showPaise(paise) }) : t('client.receive.typeAmount')}
            </button>
          </form>
        )}
      </dialog>
    </>
  );
}
