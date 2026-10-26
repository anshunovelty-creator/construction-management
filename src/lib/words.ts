import type { Locale } from '@/i18n/locale';
import type { Paise } from '@/lib/money';

// Indian grouping (lakh, crore), so the words match how amounts are said aloud on site.
const EN_ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const en99 = (n: number) => (n < 20 ? EN_ONES[n]! : EN_TENS[Math.floor(n / 10)]! + (n % 10 ? `-${EN_ONES[n % 10]}` : ''));

// Hindi has its own word for every number below 100.
const HI_99 = [
  '', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ',
  'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस',
  'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास',
  'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर',
  'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उनासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी',
  'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे',
];

const WORDS = {
  en: { two: en99, crore: 'crore', lakh: 'lakh', thousand: 'thousand', hundred: 'hundred', rupee: 'rupee', rupees: 'rupees', paise: 'paise', and: 'and' },
  hi: { two: (n: number) => HI_99[n]!, crore: 'करोड़', lakh: 'लाख', thousand: 'हज़ार', hundred: 'सौ', rupee: 'रुपया', rupees: 'रुपये', paise: 'पैसे', and: 'और' },
};
type Words = (typeof WORDS)['en'];

function spell(n: number, w: Words): string {
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  if (crore) parts.push(`${crore > 99 ? spell(crore, w) : w.two(crore)} ${w.crore}`);
  let rest = n % 1e7;
  for (const [size, unit] of [[1e5, w.lakh], [1e3, w.thousand], [100, w.hundred]] as const) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${w.two(count)} ${unit}`);
    rest %= size;
  }
  if (rest) parts.push(w.two(rest));
  return parts.join(' ');
}

/** 12500000 -> "one lakh twenty-five thousand rupees" (or the Hindi). Empty for zero or less. */
export function rupeesInWords(paise: Paise, locale: Locale): string {
  if (paise <= 0) return '';
  const w = WORDS[locale];
  const rupees = Math.floor(paise / 100);
  const cents = paise % 100;
  const r = rupees ? `${spell(rupees, w)} ${rupees === 1 ? w.rupee : w.rupees}` : '';
  const p = cents ? `${w.two(cents)} ${w.paise}` : '';
  return r && p ? `${r} ${w.and} ${p}` : r || p;
}
