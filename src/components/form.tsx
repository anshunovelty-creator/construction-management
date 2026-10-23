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
}: {
  fields: Field[];
  defaults?: Record<string, string | boolean | string[]>;
  choices?: Choices;
  action: FormAction;
  submitLabel: string;
  passwordAutoComplete?: 'current-password' | 'new-password';
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, {});
  const valueOf = (name: string) => state.values?.[name] ?? defaults[name];

  return (
    <form action={formAction} className="grid max-w-lg gap-4">
      {fields.map((field) => {
        const id = `field-${field.name}`;
        const error = state.errors?.[field.name];
        const errorId = error ? `${id}-error` : undefined;
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
            <fieldset aria-describedby={errorId}>
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
            'aria-describedby': errorId,
          };
          control = (
            <>
              <label htmlFor={id} className="font-medium">
                {label}
              </label>
              {field.kind === 'enum' || field.kind === 'ref' ? (
                <select {...shared}>
                  <option value="">{t('common.none')}</option>
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
          <div key={field.name} className="grid gap-1">
            {control}
            {error && (
              <p id={errorId} className="text-sm text-red-700">
                {t(`errors.${error}`)}
              </p>
            )}
          </div>
        );
      })}
      {state.errors?._form && (
        <p role="alert" className="text-red-700">
          {t(`errors.${state.errors._form}`)}
          {state.detail ? ` (${state.detail})` : ''}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {submitLabel}
      </button>
    </form>
  );
}
