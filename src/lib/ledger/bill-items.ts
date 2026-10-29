import { assertPaise, percentOf, type Paise } from '@/lib/money';

/** One line of a bill as typed: which material, how much of it, at what rate, and the GST on it. */
export interface ItemInput {
  materialId: string;
  /** Quantity in thousandths, so 2.5 tonnes is 2500. Up to three decimals, like the database column. */
  quantityMilli: number;
  ratePaise: Paise;
  /** GST rate in basis points: 18% = 1800. */
  gstBp: number;
}

export interface PricedItem extends ItemInput {
  /** Quantity × rate, before GST. */
  amountPaise: Paise;
  gstPaise: Paise;
}

const QUANTITY = /^\d+(?:\.\d{1,3})?$/;

/** "2.5" -> 2500. Throws on anything that is not a positive number with at most three decimals. */
export function quantityToMilli(input: string): number {
  const cleaned = input.replace(/[,\s]/g, '');
  if (!QUANTITY.test(cleaned)) throw new Error(`"${input}" is not a valid quantity`);
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(milli) || milli <= 0) throw new Error(`"${input}" is not a valid quantity`);
  return milli;
}

/**
 * Quantity × rate rounded half-up to the paisa, and the GST on that, the same way the database checks them
 * (round(quantity * rate_paise) and round(amount * gst_bp / 10000)).
 */
export function priceItem(item: ItemInput): PricedItem {
  assertPaise(item.ratePaise, 'rate');
  const amountPaise = Number((BigInt(item.quantityMilli) * BigInt(item.ratePaise) + 500n) / 1000n);
  assertPaise(amountPaise, 'item amount');
  return { ...item, amountPaise, gstPaise: percentOf(amountPaise, item.gstBp) };
}

/** The three numbers at the foot of a bill. */
export function billTotals(items: PricedItem[]): { base: Paise; gst: Paise; total: Paise } {
  const base = items.reduce((sum, i) => sum + i.amountPaise, 0);
  const gst = items.reduce((sum, i) => sum + i.gstPaise, 0);
  return { base, gst, total: base + gst };
}
