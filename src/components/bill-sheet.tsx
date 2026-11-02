'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { BillItems } from '@/components/bill-items';
import type { Choices, FormAction, FormState } from '@/components/form';
import { Icon } from '@/components/icons';
import { SearchSelect } from '@/components/search-select';
import { ENUMS } from '@/lib/masters/registry';
import { percentOf, rupeesToPaise, showPaise } from '@/lib/money';
import { rupeesInWords } from '@/lib/words';

const paiseOf = (text: string) => {
  try {
    return Math.max(rupeesToPaise(text || '0'), 0);
  } catch {
    return 0;
  }
};

type Side = 'client' | 'vendor';

/**
 * A bill laid out like the bill itself: who it is from and to, its number and date, the items, then what is cut
 * and what is left to pay. A client's bill (we bill them; they cut TDS, retention, deposit) or a party's bill (they
 * bill us; we keep back TDS). Every amount here is only a preview, worked out again on save.
 */
export function BillSheet({ side, action, party, partyNote, firm, choices, today, defaults = {} }: {
  side: Side;
  action: FormAction;
  /** The client or party the bill is with. */
  party: string;
  /** A line under their name, e.g. the party's GSTIN. */
  partyNote?: string;
  firm: string;
  choices: Choices;
  today: string;
  /** Starting values, e.g. the last bill's site. */
  defaults?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  // After a save the next bill starts afresh; after an error it keeps what was typed.
  return <Sheet key={JSON.stringify([state.values ?? null, state.saved ?? null])} side={side} state={state}
    formAction={formAction} pending={pending} party={party} partyNote={partyNote} firm={firm} choices={choices}
    today={today} defaults={defaults} />;
}

function Sheet({ side, state, formAction, pending, party, partyNote, firm, choices, today, defaults }: {
  side: Side;
  state: FormState;
  formAction: (data: FormData) => void;
  pending: boolean;
  party: string;
  partyNote?: string;
  firm: string;
  choices: Choices;
  today: string;
  defaults: Record<string, string>;
}) {
  const t = useTranslations();
  /** The vendor's wording where it differs, the client's otherwise. */
  const say = (key: string, values?: Record<string, string>) =>
    t(side === 'vendor' && t.has(`vendorBill.${key}`) ? `vendorBill.${key}` : `clientBill.${key}`, values);
  const value = (name: string) => {
    const v = state.values?.[name];
    return (Array.isArray(v) ? v[0] : v) ?? defaults[name] ?? '';
  };
  const [tds, setTds] = useState(value('tds_rate'));
  const [retention, setRetention] = useState(value('retention'));
  const [deposit, setDeposit] = useState(value('security_deposit'));
  const tdsRates = choices.tdsRates ?? [];
  const sites = choices.sites ?? [];

  // Lets a pop-up around the bill close itself once it is saved (see QuickAdd).
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) form.current?.dispatchEvent(new CustomEvent('entry-saved', { bubbles: true, detail: state.saved }));
  }, [state.saved]);

  const field = (name: string, label: string, control: (a: { id: string; invalid?: true; describedBy?: string }) => React.ReactNode,
    opts: { optional?: boolean; className?: string } = {}) => {
    const id = `${side}-bill-${name}`;
    const error = state.errors?.[name];
    return (
      <div className={`field ${opts.className ?? ''}`}>
        <label htmlFor={id}>
          {label}
          {opts.optional && <span className="optional"> {t('common.optional')}</span>}
        </label>
        {control({ id, invalid: error ? true : undefined, describedBy: error ? `${id}-error` : undefined })}
        {error && <p id={`${id}-error`} className="error">{t(`errors.${error}`)}</p>}
      </div>
    );
  };
  const rupees = (name: string, text: string, set: (v: string) => void) => (a: { id: string; invalid?: true; describedBy?: string }) => (
    <div className="affix">
      <span aria-hidden="true">₹</span>
      <input id={a.id} name={name} value={text} onChange={(e) => set(e.target.value)} inputMode="decimal" autoComplete="off"
        placeholder="0" className="num" aria-invalid={a.invalid} aria-describedby={a.describedBy} />
    </div>
  );

  return (
    <form ref={form} action={formAction} className="form bill bill-sheet">
      {state.saved && <p role="status" className="banner"><Icon name="check" /> {t('entries.saved', { serial: state.saved })}</p>}

      {/* The head of the bill: from whom to whom, for which site; its number and date on the right. */}
      <header className="cb-head">
        <div className="cb-party">
          <h3 className="cb-client"><span className="muted">{say('billTo')}</span> {party}</h3>
          <p className="muted cb-from">{[partyNote, say('from', { firm })].filter(Boolean).join(' · ')}</p>
          <div className="cb-where">
            {field('site_id', t('fields.site_id'), (a) => (
              <SearchSelect id={a.id} name="site_id" options={sites} required placeholder={t('common.choose')}
                defaultValue={value('site_id') || (sites.length === 1 ? sites[0]!.value : '')}
                aria-invalid={a.invalid} aria-describedby={a.describedBy} />
            ))}
            {side === 'vendor' && field('cost_head', say('type'), (a) => (
              <SearchSelect id={a.id} name="cost_head" defaultValue={value('cost_head')}
                placeholder={t('options.cost_head.material')}
                options={ENUMS.cost_head.map((o) => ({ value: o, label: t(`options.cost_head.${o}`) }))}
                aria-invalid={a.invalid} aria-describedby={a.describedBy} />
            ))}
          </div>
        </div>
        <div className="cb-meta">
          {field('bill_no', t('fields.bill_no'), (a) => (
            <input id={a.id} name="bill_no" defaultValue={value('bill_no')} placeholder={say('billNoPlaceholder')}
              autoComplete="off" required aria-invalid={a.invalid} aria-describedby={a.describedBy} />
          ))}
          {field('entry_date', say('date'), (a) => (
            <input id={a.id} type="date" name="entry_date" defaultValue={value('entry_date') || today} required
              aria-invalid={a.invalid} aria-describedby={a.describedBy} />
          ))}
        </div>
      </header>

      <BillItems
        materials={choices.materials ?? []}
        units={choices.units ?? []}
        gstRates={choices.gstRates ?? []}
        values={state.values ?? {}}
        errors={state.errors}
        aside={
          <div className="cb-aside">
            <fieldset className="cb-cuts">
              <legend className="bill-section">{say('cuts')}</legend>
              <p className="hint">{say('cutsHint')}</p>
              <div className={`cb-cuts-grid ${side}`}>
                {field('tds_rate', t('fields.tds_rate'), (a) => (
                  <SearchSelect id={a.id} name="tds_rate" options={tdsRates} value={tds} onChange={setTds}
                    placeholder={say('noTds')} emptyLabel={say('noTds')}
                    aria-invalid={a.invalid} aria-describedby={a.describedBy} />
                ))}
                {side === 'client' && field('retention', say('retention'), rupees('retention', retention, setRetention))}
                {side === 'client' && field('security_deposit', say('deposit'), rupees('security_deposit', deposit, setDeposit))}
              </div>
            </fieldset>
            {field('narration', t('fields.narration'), (a) => (
              <input id={a.id} name="narration" defaultValue={value('narration')} autoComplete="off"
                placeholder={say('notePlaceholder')} aria-invalid={a.invalid} aria-describedby={a.describedBy} />
            ), { optional: true })}
          </div>
        }
        summary={({ base, total }) => {
          const cuts = [
            { key: 'tds', label: say('lessTds', { rate: tdsRates.find((r) => r.value === tds)?.label ?? '' }),
              paise: tds ? percentOf(base, Number(tds)) : 0 },
            ...(side === 'client' ? [
              { key: 'ret', label: say('lessRetention'), paise: paiseOf(retention) },
              { key: 'dep', label: say('lessDeposit'), paise: paiseOf(deposit) },
            ] : []),
          ].filter((c) => c.paise > 0);
          const net = total - cuts.reduce((s, c) => s + c.paise, 0);
          return (
            <>
              {cuts.length > 0 && (
                <dl className="bill-totals cb-less">
                  {cuts.map((c) => <div key={c.key}><dt>{c.label}</dt><dd className="minus">− {showPaise(c.paise)}</dd></div>)}
                </dl>
              )}
              <div className={`cb-net ${side}`}>
                <span>{say('net')}</span>
                <strong className={net < 0 ? 'minus' : undefined}>{showPaise(net)}</strong>
              </div>
              {net > 0 && <p className="amount-words">{rupeesInWords(net)}</p>}
            </>
          );
        }}
      />

      {state.errors?._form && (
        <p role="alert" className="error form-error">
          {t(`errors.${state.errors._form}`)}{state.detail ? ` (${state.detail})` : ''}
        </p>
      )}
      <footer className="cb-foot">
        <p className="muted">{say('footHint')}</p>
        <button type="submit" className="btn big" disabled={pending}>
          <Icon name={side === 'vendor' ? 'bill' : 'invoice'} /> {pending ? '…' : say('save')}
        </button>
      </footer>
    </form>
  );
}
