/** Money is always an integer number of paise. ₹1 = 100 paise. Never use rupee floats. */
export type Paise = number;

const RUPEES_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export function assertPaise(value: number, label = 'amount'): asserts value is Paise {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a whole number of paise, got ${value}`);
  }
}

/** Parses user input like "53,118.72", "₹ 4938.9" or "-200" into paise. Rejects more than 2 decimals. */
export function rupeesToPaise(input: string): Paise {
  const cleaned = input.replace(/[₹,\s]/g, '');
  const match = RUPEES_PATTERN.exec(cleaned);
  if (!match) {
    throw new Error(`"${input}" is not a valid rupee amount`);
  }
  const [, minus, whole, fraction = ''] = match;
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  assertPaise(paise);
  return minus ? -paise : paise;
}

/** What is being typed in a rupee box, grouped the Indian way: "125000.5" -> "1,25,000.5". Drops anything else, and past 2 decimals. */
export function groupRupees(text: string): string {
  const [whole = '', ...fraction] = text.replace(/[^\d.]/g, '').split('.');
  const digits = whole.replace(/^0+(?=\d)/, '');
  const grouped = digits && new Intl.NumberFormat('en-IN').format(BigInt(digits));
  return fraction.length ? `${grouped || '0'}.${fraction.join('').slice(0, 2)}` : grouped;
}

/** A balance under ₹1 either way (up to 99 paise) counts as nothing left to pay or get back. Ledger rows are not touched. */
export const roundOffSmall = (paise: Paise): Paise => (Math.abs(paise) < 100 ? 0 : paise);

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** 619957800 -> "₹61,99,578.00" (Indian lakh/crore grouping). */
export function formatPaise(paise: Paise): string {
  assertPaise(paise);
  return INR.format(paise / 100);
}

const INR_WHOLE = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** For screens: 619957800 -> "₹61,99,578", and paise only when there are some: 5311872 -> "₹53,118.72". */
export function showPaise(paise: Paise): string {
  assertPaise(paise);
  // `+ 0` turns -0 (e.g. a negated empty sum) into 0, which Intl would otherwise print as "-₹0".
  return paise % 100 === 0 ? INR_WHOLE.format(paise / 100 + 0) : INR.format(paise / 100);
}

/** Percentage given in basis points (1% = 100 bp), rounded half-up to the nearest paisa. */
export function percentOf(amount: Paise, basisPoints: number): Paise {
  assertPaise(amount);
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new Error(`basis points must be an integer from 0 to 10000, got ${basisPoints}`);
  }
  const scaled = BigInt(amount) * BigInt(basisPoints);
  const sign = scaled < 0n ? -1n : 1n;
  const rounded = (sign * scaled + 5_000n) / 10_000n;
  return Number(sign * rounded);
}
