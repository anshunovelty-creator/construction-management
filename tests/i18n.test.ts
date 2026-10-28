import { describe, expect, it } from 'vitest';
import { ENTRY_FORMS, ENUMS, MASTERS, NEW_USER_FIELDS, EDIT_USER_FIELDS, type Field } from '@/lib/masters/registry';

/** Every entry type the app can post (PostableEntryType in src/lib/ledger/types.ts). */
const ENTRY_TYPES = [
  'opening', 'vendor_bill', 'vendor_payment', 'site_cash_expense', 'client_bill', 'client_receipt',
  'cash_transfer', 'cash_close_difference', 'owner_capital', 'owner_drawing',
];
import en from '../messages/en.json';

type Messages = { [key: string]: string | Messages };

function keys(messages: Messages, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );
}

describe('labels', () => {
  it('has a label for every field, master screen and choice', () => {
    const all = new Set(keys(en as Messages));
    const fields = [
      ...Object.values(MASTERS).flatMap((m) => m.fields),
      ...Object.values(ENTRY_FORMS).flatMap((f) => f.fields as Field[]),
      ...NEW_USER_FIELDS,
      ...EDIT_USER_FIELDS,
    ];
    const needed = [
      ...fields.map((f) => `fields.${f.name}`),
      ...Object.keys(MASTERS).map((slug) => `masters.${slug}`),
      ...Object.keys(ENTRY_FORMS).flatMap((slug) => ['title', 'when', 'what'].map((k) => `entryForms.${slug}.${k}`)),
      ...[...ENTRY_TYPES, 'reversal'].flatMap((type) => [`entryTypes.${type}.title`, `entryTypes.${type}.why`]),
      ...Object.entries(ENUMS).flatMap(([name, values]) => values.map((v) => `options.${name}.${v}`)),
    ];
    expect(needed.filter((key) => !all.has(key))).toEqual([]);
  });
});
