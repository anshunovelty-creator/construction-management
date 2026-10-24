'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { ENUMS, type Field, type RefSource } from '@/lib/masters/registry';

export interface FormState {
  /** Field name -> message key under `errors.*`; `_form` for the whole form. */
  errors?: Record<string, string>;
  /** Extra detail from the database, shown after a `save_failed` error. */
  detail?: string;
  /** What the user typed, so the form keeps it when it comes back with errors. */
  values?: Record<string, string | string[]>;
}

export type FormAction = (state: FormState, data: FormData) => Promise<FormState>;
export type Choices = Partial<Record<RefSource, { value: string; label: string }[]>>;

const INPUT_TYPES = { text: 'text', email: 'email', password: 'password', rupees: 'text', percent: 'text', date: 'date' } as const;

/** One form for every screen: renders `fields`, posts to a server action, shows its errors. */
export function Form({
  fields,
  defaults = {},
  choices = {},
  action,
  submitLabel,
  passwordAutoComplete = 'new-password',
  hintPrefix,
}: {
  fields: Field[];
  defaults?: Record<string, string | boolean | string[]>;
  choices?: Choices;
  action: FormAction;
  submitLabel: string;
  passwordAutoComplete?: 'current-password' | 'new-password';
  /** Message prefix for optional plain-language hints under fields: `<prefix>.<field name>`. */
  hintPrefix?: string;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, {});
  const valueOf = (name: string) => state.values?.[name] ?? defaults[name];

  return (
    // React resets a form after its action runs, and a <select> only reads defaultValue when it first
    // appears. A new key per returned state rebuilds the fields so every choice the user made comes back.
    <form key={JSON.stringify(state.values ?? null)} action={formAction} className="form">
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
                <select {...shared}>
                  <option value="">{t(field.required ? 'common.choose' : 'common.none')}</option>
                  {field.kind === 'enum'
                    ? ENUMS[field.enum].map((option) => (
                        <option key={option} value={option}>
                          {t(`options.${field.enum}.${option}`)}
                        </option>
                      ))
                    : (choices[field.ref] ?? []).map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                </select>
              ) : (
                <input
                  {...shared}
                  type={INPUT_TYPES[field.kind]}
                  inputMode={field.kind === 'rupees' || field.kind === 'percent' ? 'decimal' : undefined}
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
