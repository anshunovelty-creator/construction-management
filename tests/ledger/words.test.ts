import { describe, expect, it } from 'vitest';
import { rupeesInWords } from '@/lib/words';

describe('rupeesInWords', () => {
  it('says amounts the Indian way, in lakh and crore', () => {
    expect(rupeesInWords(12_500_000)).toBe('one lakh twenty-five thousand rupees');
    expect(rupeesInWords(619_957_800)).toBe('sixty-one lakh ninety-nine thousand five hundred seventy-eight rupees');
    expect(rupeesInWords(2_500_000_000)).toBe('two crore fifty lakh rupees');
    expect(rupeesInWords(150_000_000_000)).toBe('one hundred fifty crore rupees');
  });

  it('adds paise, and says one rupee', () => {
    expect(rupeesInWords(5_311_872)).toBe('fifty-three thousand one hundred eighteen rupees and seventy-two paise');
    expect(rupeesInWords(100)).toBe('one rupee');
    expect(rupeesInWords(50)).toBe('fifty paise');
  });

  it('is empty for nothing', () => {
    expect(rupeesInWords(0)).toBe('');
  });
});
