'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { ChoiceOptions } from '@/components/choice-options';
import { toLocale } from '@/i18n/locale';
import { ENUMS, type Choice, type Field, type RefSource } from '@/lib/masters/registry';
import { rupeesToPaise, showPaise } from '@/lib/money';
import { rupeesInWords } from '@/lib/words';

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
  const locale = toLocale(useLocale());
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
          <b>{showPaise(paise)}</b> · {rupeesInWords(paise, locale)}
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

  return (
    <form action={formAction} className="form">
      {state.saved && (
        <p role="status" className="banner">✓ {t('entries.saved', { serial: state.saved })}</p>
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

  return (
    <>
      {fields.map((field) => {
        const id = `field-${field.name}`;
        const error = state.errors?.[field.name];
        const hintKey = hintPrefix ? `${hintPrefix}.${field.name}` : undefined;
        const hint = hintKey && t.has(hintKey) ? t(hintKey) : undefined;
        const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
        const value = valueOf(field.name);
        const label = t(`fields.${field.name}`);
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
              {field.kind === 'enum' || field.kind === 'ref' ? (
                <select {...shared} onChange={field.name === 'vendor_id' ? (e) => setVendor(e.target.value) : undefined}>
                  <option value="">{t(field.required ? 'common.choose' : 'common.none')}</option>
                  {field.kind === 'enum'
                    ? ENUMS[field.enum].map((option) => (
                        <option key={option} value={option}>
                          {t(`options.${field.enum}.${option}`)}
                        </option>
                      ))
                    : <ChoiceOptions choices={choices[field.ref] ?? []} />}
                </select>
              ) : field.kind === 'rupees' ? (
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
          <div key={field.name} className="field">
            {control}
            {error && (
              <p id={`${id}-error`} className="error">
                {t(`errors.${error}`)}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
