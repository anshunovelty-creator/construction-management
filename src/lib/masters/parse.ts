import { assertDate } from '@/lib/ledger/balance';
import { priceItem, quantityToMilli, type PricedItem } from '@/lib/ledger/bill-items';
import { rupeesToPaise } from '@/lib/money';
import { ENUMS, type Field } from './registry';

export type Value = string | number | boolean | null | string[] | PricedItem[];
export type ParseResult =
  | { ok: true; values: Record<string, Value> }
  | { ok: false; errors: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** GSTIN: state code, PAN, entity number, Z, check character. */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
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
/**
 * The rules for a bank or cash account, said per field: a bank and each firm's own cash belong to one firm, and supervisor cash to none (the database
 * checks this too), and supervisor cash, and only that, is held by a supervisor.
 */
export function moneyAccountErrors(v: Record<string, Value>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (v.kind === 'bank' && !v.firm_id) errors.firm_id = 'bank_needs_firm';
  // Each firm keeps its own cash; supervisor cash belongs to the supervisor, not a firm.
  if (v.kind === 'owner_cash' && !v.firm_id) errors.firm_id = 'cash_needs_firm';
  if (v.kind === 'supervisor_cash' && v.firm_id) errors.firm_id = 'cash_no_firm';
  if (v.kind === 'supervisor_cash' && !v.holder_user_id) errors.holder_user_id = 'needs_supervisor';
  if (v.kind !== 'supervisor_cash' && v.holder_user_id) errors.holder_user_id = 'only_supervisor_cash';
  return Object.keys(errors).length ? errors : null;
}

/** The names a bill's item boxes are posted under, one value per line. */
export const ITEM_INPUTS = { material: 'item_material', quantity: 'item_qty', rate: 'item_rate', gst: 'item_gst' } as const;

/**
 * A bill's item lines, priced. Lines left blank are skipped; a half-filled line is an error on that line
 * (`items.<n>`, counted from 1). At least one line is needed.
 */
export function parseItems(data: FormData): { items: PricedItem[]; errors: Record<string, string> } {
  const column = (name: string) => data.getAll(name).map((v) => (typeof v === 'string' ? v.trim() : ''));
  const materials = column(ITEM_INPUTS.material);
  const quantities = column(ITEM_INPUTS.quantity);
  const rates = column(ITEM_INPUTS.rate);
  const gsts = column(ITEM_INPUTS.gst);
  const items: PricedItem[] = [];
  const errors: Record<string, string> = {};
  materials.forEach((materialId, i) => {
    const [quantity = '', rate = '', gst = ''] = [quantities[i], rates[i], gsts[i]];
    if (!materialId && !quantity && !rate) return;
    try {
      if (!UUID.test(materialId)) throw new Error('item_material');
      if (!/^\d+$/.test(gst) || Number(gst) > 10_000) throw new Error('item_gst');
      let quantityMilli: number;
      let ratePaise: number;
      try {
        quantityMilli = quantityToMilli(quantity);
      } catch {
        throw new Error('item_quantity');
      }
      try {
        ratePaise = rupeesToPaise(rate);
      } catch {
        throw new Error('item_rate');
      }
      if (ratePaise <= 0) throw new Error('item_rate');
      const item = priceItem({ materialId, quantityMilli, ratePaise, gstBp: Number(gst) });
      if (item.amountPaise <= 0) throw new Error('item_quantity');
      items.push(item);
    } catch (error) {
      errors[`items.${i + 1}`] = (error as Error).message;
    }
  });
  if (items.length === 0 && Object.keys(errors).length === 0) errors.items = 'items_needed';
  return { items, errors };
}

export function parseFields(fields: Field[], data: FormData): ParseResult {
  const values: Record<string, Value> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = data.get(field.name);
    const text = typeof raw === 'string' ? raw.trim() : '';

    if (field.kind === 'items') {
      const parsed = parseItems(data);
      Object.assign(errors, parsed.errors);
      values[field.name] = parsed.items;
      continue;
    }
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
        if (field.name === 'gst_number') {
          // A GST number is 15 capitals and digits, with no spaces; people type it in any case.
          const gstin = text.replace(/\s+/g, '').toUpperCase();
          if (GSTIN.test(gstin)) values[field.name] = gstin;
          else errors[field.name] = 'invalid_gstin';
        } else {
          values[field.name] = text;
        }
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
        // A TDS rate is a value (basis points), not a row, so it is a number rather than an id.
        if (UUID.test(text) || (field.ref === 'tdsRates' && /^\d{1,5}$/.test(text))) values[field.name] = text;
        else errors[field.name] = 'invalid_choice';
        break;
      case 'rupees':
        try {
          const paise = rupeesToPaise(text);
          if (paise < 0 || (paise === 0 && !field.allowZero)) throw new Error('not positive');
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
