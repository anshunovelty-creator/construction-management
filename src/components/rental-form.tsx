'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import type { FormAction, FormState } from '@/components/form';
import { Icon } from '@/components/icons';
import { SearchSelect } from '@/components/search-select';
import type { Choice } from '@/lib/masters/registry';
import { rupeesToPaise, showPaise } from '@/lib/money';
import { rentPaise } from '@/lib/rent';

const milliOf = (text: string) => {
  const n = Number(text.replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : 0;
};
const paiseOf = (text: string) => {
  try {
    return Math.max(rupeesToPaise(text), 0);
  } catch {
    return 0;
  }
};

/**
 * "+ Add rented items": what came (item, how many, rent per day), where and from when, and who from with the bill,
 * if known. Beside it, the meter it starts: rent a day, a week and a month at that rate.
 */
export function RentalForm({ action, sites, vendors, items, today }: {
  action: FormAction;
  sites: Choice[];
  vendors: Choice[];
  /** Items typed before, offered as the item is typed. */
  items: string[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  // After a save the form starts afresh; after an error it keeps what was typed.
  return <Fields key={JSON.stringify([state.values ?? null, state.saved ?? null])}
    state={state} formAction={formAction} pending={pending} sites={sites} vendors={vendors} items={items} today={today} />;
}

function Fields({ state, formAction, pending, sites, vendors, items, today }: {
  state: FormState;
  formAction: (data: FormData) => void;
  pending: boolean;
  sites: Choice[];
  vendors: Choice[];
  items: string[];
  today: string;
}) {
  const t = useTranslations();
  const value = (name: string) => String(state.values?.[name] ?? '');
  const [qty, setQty] = useState(value('rent_qty'));
  const [rate, setRate] = useState(value('rent_rate'));
  const [item, setItem] = useState(value('rent_item'));
  const perDay = rentPaise(milliOf(qty), paiseOf(rate), 1);

  const field = (name: string, label: string, control: (a: { id: string; invalid?: true; describedBy?: string }) => React.ReactNode,
    opts: { optional?: boolean; hint?: string; span?: string } = {}) => {
    const id = `rent-${name}`;
    const error = state.errors?.[name];
    const describedBy = [opts.hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
    return (
      <div className={`field ${opts.span ?? ''}`}>
        <label htmlFor={id}>
          {label}
          {opts.optional && <span className="optional"> {t('common.optional')}</span>}
        </label>
        {control({ id, invalid: error ? true : undefined, describedBy })}
        {opts.hint && <p id={`${id}-hint`} className="hint">{opts.hint}</p>}
        {error && <p id={`${id}-error`} className="error">{t(`errors.${error}`)}</p>}
      </div>
    );
  };

  return (
    <form action={formAction} className="rent-form">
      {state.saved && <p role="status" className="banner"><Icon name="check" /> {t('rentals.saved', { serial: state.saved })}</p>}
      <div className="rent-layout">
        <div className="rent-groups">
          <fieldset className="rent-group">
            <legend className="bill-section">{t('rentals.groupWhat')}</legend>
            <div className="rent-grid">
              {field('rent_item', t('fields.rent_item'), (a) => (
                <>
                  <input id={a.id} name="rent_item" value={item} onChange={(e) => setItem(e.target.value)} list="rent-items"
                    placeholder={t('rentals.itemPlaceholder')} autoComplete="off" required
                    aria-invalid={a.invalid} aria-describedby={a.describedBy} />
                  <datalist id="rent-items">{items.map((i) => <option key={i} value={i} />)}</datalist>
                </>
              ), { span: 'wide' })}
              {field('rent_qty', t('fields.rent_qty'), (a) => (
                <input id={a.id} name="rent_qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal"
                  placeholder="10" autoComplete="off" required className="num" aria-invalid={a.invalid} aria-describedby={a.describedBy} />
              ))}
              {field('rent_rate', t('fields.rent_rate'), (a) => (
                <div className="affix">
                  <span aria-hidden="true">₹</span>
                  <input id={a.id} name="rent_rate" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal"
                    placeholder="0.75" autoComplete="off" required className="num" aria-invalid={a.invalid} aria-describedby={a.describedBy} />
                </div>
              ), { hint: t('rentals.hints.rent_rate') })}
            </div>
          </fieldset>

          <fieldset className="rent-group">
            <legend className="bill-section">{t('rentals.groupWhere')}</legend>
            <div className="rent-grid">
              {field('site_id', t('fields.site_id'), (a) => (
                <SearchSelect id={a.id} name="site_id" options={sites} required placeholder={t('common.choose')}
                  defaultValue={value('site_id') || (sites.length === 1 ? sites[0]!.value : '')}
                  aria-invalid={a.invalid} aria-describedby={a.describedBy} />
              ), { span: 'half' })}
              {field('rented_on', t('fields.rented_on'), (a) => (
                <input id={a.id} type="date" name="rented_on" defaultValue={value('rented_on') || today} max={today} required
                  aria-invalid={a.invalid} aria-describedby={a.describedBy} />
              ), { span: 'half', hint: t('rentals.hints.rented_on') })}
            </div>
          </fieldset>

          <fieldset className="rent-group">
            <legend className="bill-section">
              {t('rentals.groupBill')} <span className="optional">{t('common.optional')}</span>
            </legend>
            <div className="rent-grid">
              {field('rented_from', t('fields.rented_from'), (a) => (
                <SearchSelect id={a.id} name="rented_from" options={vendors} placeholder={t('common.none')}
                  defaultValue={value('rented_from')} aria-invalid={a.invalid} aria-describedby={a.describedBy} />
              ), { span: 'half' })}
              {field('bill_no', t('fields.bill_no'), (a) => (
                <input id={a.id} name="bill_no" defaultValue={value('bill_no')} autoComplete="off"
                  aria-invalid={a.invalid} aria-describedby={a.describedBy} />
              ), { span: 'half', hint: t('rentals.hints.bill_no') })}
            </div>
          </fieldset>
        </div>

        {/* The meter this starts, worked out again on save; here only as a preview. */}
        <aside className="card rent-meter" aria-live="polite">
          <p className="section-title"><Icon name="rent" /> {t('rentals.meter')}</p>
          <p className="rent-meter-day">
            <span className="amount">{showPaise(perDay)}</span>
            <span className="muted"> {t('rentals.perDay')}</span>
          </p>
          <p className="muted rent-meter-sum">
            {perDay > 0 ? t('rentals.meterSum', { qty: qty.trim(), rate: showPaise(paiseOf(rate)), item: item.trim() || t('rentals.items') })
              : t('rentals.meterEmpty')}
          </p>
          <dl className="rent-meter-rows">
            <div><dt>{t('rentals.week')}</dt><dd className="amount">{showPaise(perDay * 7)}</dd></div>
            <div><dt>{t('rentals.month')}</dt><dd className="amount">{showPaise(perDay * 30)}</dd></div>
          </dl>
        </aside>
      </div>

      {state.errors?._form && (
        <p role="alert" className="error form-error">
          {t(`errors.${state.errors._form}`)}{state.detail ? ` (${state.detail})` : ''}
        </p>
      )}
      <div className="rent-actions">
        <button type="submit" className="btn big" disabled={pending}>
          <Icon name="rent" /> {pending ? '…' : t('rentals.add')}
        </button>
      </div>
    </form>
  );
}
