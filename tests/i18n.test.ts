import { describe, expect, it } from 'vitest';
import { ENUMS, MASTERS, NEW_USER_FIELDS, EDIT_USER_FIELDS } from '@/lib/masters/registry';
import en from '../messages/en.json';
import hi from '../messages/hi.json';

type Messages = { [key: string]: string | Messages };

function keys(messages: Messages, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );
}

describe('translations', () => {
  it('has the same keys in English and Hindi, none empty', () => {
    expect(keys(hi).sort()).toEqual(keys(en).sort());
    for (const messages of [en, hi] as Messages[]) {
      const empty = keys(messages).filter((key) => key.split('.').reduce<unknown>((m, k) => (m as Messages)[k], messages) === '');
      expect(empty).toEqual([]);
    }
  });

  it('has a label for every field, master screen and choice', () => {
    const all = new Set(keys(en as Messages));
    const fields = [...Object.values(MASTERS).flatMap((m) => m.fields), ...NEW_USER_FIELDS, ...EDIT_USER_FIELDS];
    const needed = [
      ...fields.map((f) => `fields.${f.name}`),
      ...Object.keys(MASTERS).map((slug) => `masters.${slug}`),
      ...Object.entries(ENUMS).flatMap(([name, values]) => values.map((v) => `options.${name}.${v}`)),
    ];
    expect(needed.filter((key) => !all.has(key))).toEqual([]);
  });
});
