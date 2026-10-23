import { describe, expect, it } from 'vitest';
import { formatPaise, percentOf, rupeesToPaise } from '@/lib/money';

describe('rupeesToPaise', () => {
  it('parses plain, grouped and symbol-prefixed amounts', () => {
    expect(rupeesToPaise('53118.72')).toBe(5_311_872);
    expect(rupeesToPaise('61,99,578')).toBe(619_957_800);
    expect(rupeesToPaise('₹ 4,938.9')).toBe(493_890);
    expect(rupeesToPaise('-200')).toBe(-20_000);
    expect(rupeesToPaise('0.05')).toBe(5);
  });

  it('rejects anything that is not an exact rupee amount', () => {
    expect(() => rupeesToPaise('')).toThrow('not a valid rupee amount');
    expect(() => rupeesToPaise('12.345')).toThrow('not a valid rupee amount');
    expect(() => rupeesToPaise('abc')).toThrow('not a valid rupee amount');
    expect(() => rupeesToPaise('1e5')).toThrow('not a valid rupee amount');
  });
});

describe('formatPaise', () => {
  it('uses Indian lakh grouping', () => {
    expect(formatPaise(619_957_800)).toBe('₹61,99,578.00');
    expect(formatPaise(5_311_872)).toBe('₹53,118.72');
    expect(formatPaise(-493_890)).toBe('-₹4,938.90');
  });

  it('refuses fractional paise', () => {
    expect(() => formatPaise(10.5)).toThrow('whole number of paise');
  });
});

describe('percentOf', () => {
  it('computes basis-point percentages rounded half-up to the paisa', () => {
    expect(percentOf(100_000_000, 100)).toBe(1_000_000); // 1% of ₹10,00,000
    expect(percentOf(100_000_000, 500)).toBe(5_000_000); // 5%
    expect(percentOf(5_311_872, 100)).toBe(53_119); // 531.1872 -> 531.19
    expect(percentOf(5_311_850, 100)).toBe(53_119); // 531.185 -> 531.19 (half-up)
  });

  it('rejects invalid basis points', () => {
    expect(() => percentOf(100, 10_001)).toThrow('basis points');
    expect(() => percentOf(100, 1.5)).toThrow('basis points');
  });
});
