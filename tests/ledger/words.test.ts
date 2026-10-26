import { describe, expect, it } from 'vitest';
import { rupeesInWords } from '@/lib/words';

describe('rupeesInWords', () => {
  it('says amounts the Indian way, in lakh and crore', () => {
    expect(rupeesInWords(12_500_000, 'en')).toBe('one lakh twenty-five thousand rupees');
    expect(rupeesInWords(619_957_800, 'en')).toBe('sixty-one lakh ninety-nine thousand five hundred seventy-eight rupees');
    expect(rupeesInWords(2_500_000_000, 'en')).toBe('two crore fifty lakh rupees');
    expect(rupeesInWords(150_000_000_000, 'en')).toBe('one hundred fifty crore rupees');
  });

  it('adds paise, and says one rupee', () => {
    expect(rupeesInWords(5_311_872, 'en')).toBe('fifty-three thousand one hundred eighteen rupees and seventy-two paise');
    expect(rupeesInWords(100, 'en')).toBe('one rupee');
    expect(rupeesInWords(50, 'en')).toBe('fifty paise');
  });

  it('speaks Hindi', () => {
    expect(rupeesInWords(12_500_000, 'hi')).toBe('एक लाख पच्चीस हज़ार रुपये');
    expect(rupeesInWords(4_509_900, 'hi')).toBe('पैंतालीस हज़ार निन्यानवे रुपये');
    expect(rupeesInWords(100_050, 'hi')).toBe('एक हज़ार रुपये और पचास पैसे');
  });

  it('is empty for nothing', () => {
    expect(rupeesInWords(0, 'en')).toBe('');
  });
});
