'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { BillItems } from '@/components/bill-items';
import { SearchSelect } from '@/components/search-select';
import { ENUMS, type Choice, type Field, type RefSource } from '@/lib/masters/registry';
import { rupeesToPaise, showPaise } from '@/lib/money';
import { rupeesInWords } from '@/lib/words';
import { Icon } from '@/components/icons';

export interface FormState {
  /** Field name -> message key under `errors.*`; `_form` for the whole form. */
  errors?: Record<string, string>;
  /** Extra detail from the database, shown after a `save_failed` error. */
  detail?: string;
  /** What the user typed, so the form keeps it when it comes back with errors. */
  values?: Record<string, string | string[]>;
  /** Serial of the entry just saved, when the form stays open for the next one. */
  saved?: string;
}

/** What a vendor is still owed, for the "Pay full" button on a payment. */
export type Owed = { name: string; paise: number };

export type FormAction = (state: FormState, data: FormData) => Promise<FormState>;
export type Choices = Partial<Record<RefSource, Choice[]>>;

const INPUT_TYPES = { text: 'text', email: 'email', password: 'password', percent: 'text', date: 'date' } as const;

const toPaise = (text: string) => {
  try {
    return rupeesToPaise(text);
  } catch {
    return 0;
  }
};
const asRupees = (paise: number) => (paise % 100 ? (paise / 100).toFixed(2) : String(paise / 100));

/**
 * A rupee box that says the amount back as it is typed ("₹1,25,000 · one lakh twenty-five thousand rupees"),
 * so an extra zero shows before saving. With `owed`, it also offers to fill in the full amount still due.
 */
function RupeesInput({ input, owed }: { input: React.InputHTMLAttributes<HTMLInputElement> & { id: string }; owed?: Owed }) {
  const t = useTranslations();
  const [text, setText] = useState(String(input.defaultValue ?? ''));
  const paise = toPaise(text);
  const { defaultValue: _, ...rest } = input;
  return (
    <>
      {owed && (
        <p className="owed">
          {owed.paise > 0 ? (
            <>
              <span>{t('quick.owe', { name: owed.name, amount: showPaise(owed.paise) })}</span>
              <button type="button" className="btn ghost small" onClick={() => setText(asRupees(owed.paise))}>
                {t('quick.payFull', { amount: showPaise(owed.paise) })}
              </button>
            </>
          ) : (
            <span className="muted">{t('quick.nothingOwed', { name: owed.name })}</span>
          )}
        </p>
      )}
      <input {...rest} type="text" inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
      {paise > 0 && (
        <p className="amount-words">
          <b>{showPaise(paise)}</b> · {rupeesInWords(paise)}
        </p>
      )}
    </>
  );
}

/** One form for every screen: renders `fields`, posts to a server action, shows its errors. */
export function Form({
  fields,
  defaults = {},
  choices = {},
  action,
  submitLabel,
  passwordAutoComplete = 'new-password',
  hintPrefix,
  owed,
  vendorId,
}: {
  fields: Field[];
  defaults?: Record<string, string | boolean | string[]>;
  choices?: Choices;
  action: FormAction;
  submitLabel: string;
  passwordAutoComplete?: 'current-password' | 'new-password';
  /** Message prefix for optional plain-language hints under fields: `<prefix>.<field name>`. */
  hintPrefix?: string;
  /** What each vendor is still owed (by vendor id), shown above the amount on a payment. */
  owed?: Record<string, Owed>;
  /** The vendor, when the form is for one vendor and has no vendor box. */
  vendorId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const t = useTranslations();
  const form = useRef<HTMLFormElement>(null);
  // Lets a pop-up around the form close itself once the entry is saved (see QuickAdd).
  useEffect(() => {
    if (state.saved) form.current?.dispatchEvent(new CustomEvent('entry-saved', { bubbles: true, detail: state.saved }));
  }, [state]);

  return (
    <form ref={form} action={formAction} className={fields.some((f) => f.kind === 'items') ? 'form bill' : 'form'}>
      {state.saved && (
        <p role="status" className="banner"><Icon name="check" /> {t('entries.saved', { serial: state.saved })}</p>
      )}
      {/* React resets a form after its action runs, and a <select> only reads defaultValue when it first
          appears. A new key per returned state rebuilds the fields so every choice the user made comes back,
          or, after a save, starts the next entry afresh. */}
      <Fields
        key={JSON.stringify([state.values ?? null, state.saved ?? null])}
        fields={fields}
        state={state}
        defaults={defaults}
        choices={choices}
        passwordAutoComplete={passwordAutoComplete}
        hintPrefix={hintPrefix}
        owed={owed}
        vendorId={vendorId}
      />
      {state.errors?._form && (
        <p role="alert" className="error form-error">
          {t(`errors.${state.errors._form}`)}
          {state.detail ? ` (${state.detail})` : ''}
        </p>
      )}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? '…' : submitLabel}
      </button>
    </form>
  );
}

function Fields({
  fields,
  state,
  defaults,
  choices,
  passwordAutoComplete,
  hintPrefix,
  owed,
  vendorId,
}: {
  fields: Field[];
  state: FormState;
  defaults: Record<string, string | boolean | string[]>;
  choices: Choices;
  passwordAutoComplete: 'current-password' | 'new-password';
  hintPrefix?: string;
  owed?: Record<string, Owed>;
  vendorId?: string;
}) {
  const t = useTranslations();
  const valueOf = (name: string) => state.values?.[name] ?? defaults[name];
  // The vendor picked so far, so the amount box can say what they are still owed.
  const [vendor, setVendor] = useState(vendorId ?? String(valueOf('vendor_id') ?? ''));
  // How the money moved, on payment forms: the bank/cash box then lists only accounts that fit (cash: cash accounts;
  // online or cheque: banks), the same rule the save checks.
  const paidHow = fields.some((f) => f.name === 'payment_method');
  const [method, setMethod] = useState(String(valueOf('payment_method') ?? ''));
  const fits = (c: Choice) => !paidHow || !method || c.kind === undefined || (method === 'cash') === (c.kind !== 'bank');
  const onPick = (name: string) => (name === 'vendor_id' ? setVendor : name === 'payment_method' ? setMethod : undefined);

  const renderField = (field: Field) => {
        // The items table is drawn by BillItems, below.
        if (field.kind === 'items') return null;
        const id = `field-${field.name}`;
        const error = state.errors?.[field.name];
        const hintKey = hintPrefix ? `${hintPrefix}.${field.name}` : undefined;
        const hint = hintKey && t.has(hintKey) ? t(hintKey) : undefined;
        const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
        const value = valueOf(field.name);
        const label = t(`fields.${field.name}`);
        // What an empty choice means on this form, when that is not simply "none" (e.g. "work order's %").
        const emptyKey = hintPrefix ? `${hintPrefix.replace(/hints$/, 'empty')}.${field.name}` : undefined;
        const emptyLabel = emptyKey && t.has(emptyKey) ? t(emptyKey) : t(field.required ? 'common.choose' : 'common.none');
        let control: React.ReactNode;

        if (field.kind === 'checkbox') {
          const checked = state.values ? state.values[field.name] === 'on' : value !== false;
          control = (
            <label className="flex items-center gap-2">
              <input type="checkbox" name={field.name} defaultChecked={checked} /> {label}
            </label>
          );
        } else if (field.kind === 'multi') {
          const chosen = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
          control = (
            <fieldset aria-describedby={describedBy}>
              <legend className="font-medium">{label}</legend>
              {(choices[field.ref] ?? []).map((choice) => (
                <label key={choice.value} className="flex items-center gap-2">
                  <input type="checkbox" name={field.name} value={choice.value} defaultChecked={chosen.includes(choice.value)} />
                  {choice.label}
                </label>
              ))}
            </fieldset>
          );
        } else {
          const shared = {
            id,
            name: field.name,
            defaultValue: typeof value === 'string' ? value : '',
            required: field.required,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': describedBy,
          };
          control = (
            <>
              <label htmlFor={id} className="font-medium">
                {label}
                {!field.required && <span className="optional"> {t('common.optional')}</span>}
              </label>
              {hint && (
                <p id={`${id}-hint`} className="hint">
                  {hint}
                </p>
              )}
              {field.kind === 'enum' ? (
                <SearchSelect
                  {...shared}
                  placeholder={emptyLabel}
                  onChange={onPick(field.name)}
                  options={ENUMS[field.enum].map((option) => ({ value: option, label: t(`options.${field.enum}.${option}`) }))}
                />
              ) : field.kind === 'ref' ? (() => {
                const options = (choices[field.ref] ?? []).filter(fits);
                // A new key when the method changes starts the box afresh, dropping an account that no longer fits.
                const keep = options.some((o) => o.value === shared.defaultValue) ? shared.defaultValue : '';
                return (
                  <>
                    <SearchSelect key={method} {...shared} defaultValue={keep} placeholder={emptyLabel}
                      onChange={onPick(field.name)} options={options} />
                    {paidHow && method && options.length === 0 && (choices[field.ref] ?? []).some((c) => c.kind) && (
                      <p className="hint">{t(method === 'cash' ? 'form.noCashAccount' : 'form.noBankAccount')}</p>
                    )}
                  </>
                );
              })() : field.kind === 'rupees' ? (
                <RupeesInput input={shared} owed={field.name === 'amount' && owed ? owed[vendor] : undefined} />
              ) : (
                <input
                  {...shared}
                  type={INPUT_TYPES[field.kind]}
                  inputMode={field.kind === 'percent' ? 'decimal' : undefined}
                  autoComplete={field.kind === 'password' ? passwordAutoComplete : field.kind === 'email' ? 'username' : 'off'}
                />
              )}
            </>
          );
        }

        return (
          <div key={field.name} className={`field f-${field.name}`}>
            {control}
            {error && (
              <p id={`${id}-error`} className="error">
                {t(`errors.${error}`)}
              </p>
            )}
          </div>
        );
  };

  // A bill has an items table: the details above it, and the notes, deductions and totals below it.
  const itemsAt = fields.findIndex((f) => f.kind === 'items');
  if (itemsAt < 0) return <>{fields.map(renderField)}</>;
  return (
    <>
      <p className="bill-section">{t('items.details')}</p>
      <div className="bill-head">{fields.slice(0, itemsAt).map(renderField)}</div>
      <BillItems
        materials={choices.materials ?? []}
        gstRates={choices.gstRates ?? []}
        values={state.values ?? {}}
        errors={state.errors}
        aside={<div className="bill-aside">{fields.slice(itemsAt + 1).map(renderField)}</div>}
      />
    </>
  );
}
