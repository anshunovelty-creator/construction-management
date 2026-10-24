import type { getTranslations } from 'next-intl/server';
import type { Choices } from '@/components/form';
import type { Column } from '@/components/entry-sheet';
import { ENUMS, type Field } from '@/lib/masters/registry';

type T = Awaited<ReturnType<typeof getTranslations>>;

/** Sheet columns for an entry form's fields, in the order given. */
export function sheetColumns(slug: string, fields: Field[], choices: Choices, t: T): Column[] {
  return fields.map((field) => {
    const hintKey = `entryForms.${slug}.hints.${field.name}`;
    const base = {
      name: field.name,
      // Drop form hints such as "(₹)" from the short column heading; the full hint shows on hover.
      label: t(`fields.${field.name}`).replace(/\s*\(.*\)$/, ''),
      hint: t.has(hintKey) ? t(hintKey) : undefined,
      required: Boolean(field.required),
    };
    if (field.kind === 'ref') return { ...base, kind: 'select', options: choices[field.ref] ?? [] };
    if (field.kind === 'enum') {
      return { ...base, kind: 'select', options: ENUMS[field.enum].map((v) => ({ value: v, label: t(`options.${field.enum}.${v}`) })) };
    }
    return { ...base, kind: field.kind === 'rupees' || field.kind === 'date' ? field.kind : 'text' };
  });
}
