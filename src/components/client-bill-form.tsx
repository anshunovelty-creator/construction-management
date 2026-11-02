'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { BillItems } from '@/components/bill-items';
import type { Choices, FormAction, FormState } from '@/components/form';
import { Icon } from '@/components/icons';
import { SearchSelect } from '@/components/search-select';
import { percentOf, rupeesToPaise, showPaise } from '@/lib/money';
import { rupeesInWords } from '@/lib/words';

const paiseOf = (text: string) => {
  try {
    return Math.max(rupeesToPaise(text || '0'), 0);
  } catch {
    return 0;
  }
};

/**
 * A bill given to a client, laid out like the bill itself: who it is to and from, its number and date, the items,
 * then what the client cuts (TDS, retention, deposit) and what is left for them to pay. Saved by postClientBill;
 * every amount here is only a preview, worked out again on save.
 */
export function ClientBillForm({ action, client, firm, choices, today }: {
  action: FormAction;
  client: string;
  firm: string;
  choices: Choices;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  // After a save the next bill starts afresh; after an error it keeps what was typed.
  return <Sheet key={JSON.stringify([state.values ?? null, state.saved ?? null])}
    state={state} formAction={formAction} pending={pending} client={client} firm={firm} choices={choices} today={today} />;
}

function Sheet({ state, formAction, pending, client, firm, choices, today }: {
  state: FormState;
  formAction: (data: FormData) => void;
  pending: boolean;
  client: string;
  firm: string;
  choices: Choices;
  today: string;
}) {
  const t = useTranslations();
  const value = (name: string) => {
    const v = state.values?.[name];
    return Array.isArray(v) ? v[0] ?? '' : v ?? '';
  };
  const [tds, setTds] = useState(value('tds_rate'));
  const [retention, setRetention] = useState(value('retention'));
  const [deposit, setDeposit] = useState(value('security_deposit'));
  const tdsRates = choices.tdsRates ?? [];

  const field = (name: string, label: string, control: (a: { id: string; invalid?: true; describedBy?: string }) => React.ReactNode,
    opts: { optional?: boolean; className?: string } = {}) => {
    const id = `cb-${name}`;
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
    <form action={formAction} className="form bill client-bill">
      {state.saved && <p role="status" className="banner"><Icon name="check" /> {t('entries.saved', { serial: state.saved })}</p>}

      {/* The head of the bill: to whom, from which firm, for which site; its number and date on the right. */}
      <header className="cb-head">
        <div className="cb-party">
          <h3 className="cb-client"><span className="muted">{t('clientBill.billTo')}</span> {client}</h3>
          <p className="muted cb-from">{t('clientBill.from', { firm })}</p>
          {field('site_id', t('fields.site_id'), (a) => (
            <SearchSelect id={a.id} name="site_id" options={choices.sites ?? []} required placeholder={t('common.choose')}
              defaultValue={value('site_id') || ((choices.sites ?? []).length === 1 ? choices.sites![0]!.value : '')}
              aria-invalid={a.invalid} aria-describedby={a.describedBy} />
          ), { className: 'cb-site' })}
        </div>
        <div className="cb-meta">
          {field('bill_no', t('fields.bill_no'), (a) => (
            <input id={a.id} name="bill_no" defaultValue={value('bill_no')} placeholder={t('clientBill.billNoPlaceholder')}
              autoComplete="off" required aria-invalid={a.invalid} aria-describedby={a.describedBy} />
          ))}
          {field('entry_date', t('clientBill.date'), (a) => (
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
              <legend className="bill-section">{t('clientBill.cuts')}</legend>
              <p className="hint">{t('clientBill.cutsHint')}</p>
              <div className="cb-cuts-grid">
                {field('tds_rate', t('fields.tds_rate'), (a) => (
                  <SearchSelect id={a.id} name="tds_rate" options={tdsRates} value={tds} onChange={setTds}
                    placeholder={t('clientBill.noTds')} emptyLabel={t('clientBill.noTds')}
                    aria-invalid={a.invalid} aria-describedby={a.describedBy} />
                ))}
                {field('retention', t('clientBill.retention'), rupees('retention', retention, setRetention))}
                {field('security_deposit', t('clientBill.deposit'), rupees('security_deposit', deposit, setDeposit))}
              </div>
            </fieldset>
            {field('narration', t('fields.narration'), (a) => (
              <input id={a.id} name="narration" defaultValue={value('narration')} autoComplete="off"
                placeholder={t('clientBill.notePlaceholder')} aria-invalid={a.invalid} aria-describedby={a.describedBy} />
            ), { optional: true })}
          </div>
        }
        summary={({ base, total }) => {
          const tdsPaise = tds ? percentOf(base, Number(tds)) : 0;
          const cuts = [
            { key: 'tds', label: t('clientBill.lessTds', { rate: tdsRates.find((r) => r.value === tds)?.label ?? '' }), paise: tdsPaise },
            { key: 'ret', label: t('clientBill.lessRetention'), paise: paiseOf(retention) },
            { key: 'dep', label: t('clientBill.lessDeposit'), paise: paiseOf(deposit) },
          ].filter((c) => c.paise > 0);
          const net = total - cuts.reduce((s, c) => s + c.paise, 0);
          return (
            <>
              {cuts.length > 0 && (
                <dl className="bill-totals cb-less">
                  {cuts.map((c) => <div key={c.key}><dt>{c.label}</dt><dd className="minus">− {showPaise(c.paise)}</dd></div>)}
                </dl>
              )}
              <div className="cb-net">
                <span>{t('clientBill.net')}</span>
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
        <p className="muted">{t('clientBill.footHint')}</p>
        <button type="submit" className="btn big" disabled={pending}>
          <Icon name="invoice" /> {pending ? '…' : t('clientBill.save')}
        </button>
      </footer>
    </form>
  );
}
