import { assertDate } from '@/lib/ledger/balance';
import { rupeesToPaise } from '@/lib/money';
import { ENUMS, type Field } from './registry';

export type Value = string | number | boolean | null | string[];
export type ParseResult =
  | { ok: true; values: Record<string, Value> }
  | { ok: false; errors: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERCENT = /^\d{1,3}(?:\.\d{1,2})?$/;

/** "1" -> 100, "0.5" -> 50, "12.25" -> 1225 basis points. Accepts 0 to 100 with up to two decimals. */
export function percentToBasisPoints(input: string): number {
  const cleaned = input.replace(/[%\s]/g, '');
  if (!PERCENT.test(cleaned)) {
    throw new Error(`"${input}" is not a valid percentage`);
  }
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const bp = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (bp > 10_000) {
    throw new Error(`"${input}" is more than 100%`);
  }
  return bp;
}

/**
 * Turns submitted form data into column values, or field errors (message keys under `errors.*`).
 * Empty optional fields become the column's empty value; an empty optional password is left out.
 */
export function parseFields(fields: Field[], data: FormData): ParseResult {
  const values: Record<string, Value> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = data.get(field.name);
    const text = typeof raw === 'string' ? raw.trim() : '';

    if (field.kind === 'checkbox') {
      values[field.name] = raw === 'on';
      continue;
    }
    if (field.kind === 'multi') {
      const chosen = data.getAll(field.name).filter((v): v is string => typeof v === 'string');
      if (!chosen.every((v) => UUID.test(v))) errors[field.name] = 'invalid_choice';
      else values[field.name] = chosen;
      continue;
    }
    if (text === '') {
      if (field.required) errors[field.name] = 'required';
      else if (field.kind === 'text') values[field.name] = '';
      else if (field.kind === 'percent') values[field.name] = 0;
      else if (field.kind !== 'password') values[field.name] = null;
      continue;
    }

    switch (field.kind) {
      case 'text':
        values[field.name] = text;
        break;
      case 'email':
        if (EMAIL.test(text)) values[field.name] = text.toLowerCase();
        else errors[field.name] = 'invalid_email';
        break;
      case 'password':
        // Passwords are taken exactly as typed.
        if (typeof raw === 'string' && raw.length >= 8) values[field.name] = raw;
        else errors[field.name] = 'password_short';
        break;
      case 'enum':
        if ((ENUMS[field.enum] as readonly string[]).includes(text)) values[field.name] = text;
        else errors[field.name] = 'invalid_choice';
        break;
      case 'ref':
        if (UUID.test(text)) values[field.name] = text;
        else errors[field.name] = 'invalid_choice';
        break;
      case 'rupees':
        try {
          const paise = rupeesToPaise(text);
          if (paise <= 0) throw new Error('not positive');
          values[field.name] = paise;
        } catch {
          errors[field.name] = 'invalid_amount';
        }
        break;
      case 'percent':
        try {
          values[field.name] = percentToBasisPoints(text);
        } catch {
          errors[field.name] = 'invalid_percent';
        }
        break;
      case 'date':
        try {
          assertDate(text, field.name);
          values[field.name] = text;
        } catch {
          errors[field.name] = 'invalid_date';
        }
        break;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** A stored column value as the form shows it (paise as rupees, basis points as a percentage). */
export function toFormValue(field: Field, value: unknown): string | boolean | string[] {
  if (field.kind === 'checkbox') return Boolean(value);
  if (field.kind === 'multi') return Array.isArray(value) ? value.map(String) : [];
  if (value === null || value === undefined || field.kind === 'password') return '';
  if (field.kind === 'rupees') return (Number(value) / 100).toFixed(2);
  if (field.kind === 'percent') return String(Number(value) / 100);
  return String(value);
}

/** What the user typed, so a form that comes back with errors keeps its input. */
export function submittedValues(data: FormData): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const key of new Set(data.keys())) {
    if (key.startsWith('$') || key === 'password') continue;
    const all = data.getAll(key).filter((v): v is string => typeof v === 'string');
    values[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  return values;
}
