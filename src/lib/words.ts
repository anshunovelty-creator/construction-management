import type { Paise } from '@/lib/money';

// Indian grouping (lakh, crore), so the words match how amounts are said aloud on site.
const EN_ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const en99 = (n: number) => (n < 20 ? EN_ONES[n]! : EN_TENS[Math.floor(n / 10)]! + (n % 10 ? `-${EN_ONES[n % 10]}` : ''));

function spell(n: number): string {
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  if (crore) parts.push(`${crore > 99 ? spell(crore) : en99(crore)} crore`);
  let rest = n % 1e7;
  for (const [size, unit] of [[1e5, 'lakh'], [1e3, 'thousand'], [100, 'hundred']] as const) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${en99(count)} ${unit}`);
    rest %= size;
  }
  if (rest) parts.push(en99(rest));
  return parts.join(' ');
}

/** 12500000 -> "one lakh twenty-five thousand rupees". Empty for zero or less. */
export function rupeesInWords(paise: Paise): string {
  if (paise <= 0) return '';
  const rupees = Math.floor(paise / 100);
  const cents = paise % 100;
  const r = rupees ? `${spell(rupees)} ${rupees === 1 ? 'rupee' : 'rupees'}` : '';
  const p = cents ? `${en99(cents)} paise` : '';
  return r && p ? `${r} and ${p}` : r || p;
}
