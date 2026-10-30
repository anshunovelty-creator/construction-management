import { describe, expect, it } from 'vitest';
import { amountPaise, measurementText, quantityMilli } from '@/lib/work';

describe('work done measurements', () => {
  it('works out the SVG sheet lines from No., length, width and height', () => {
    expect(quantityMilli('area', { length: '4.3', width: '1.3' })).toBe(5_590);
    expect(quantityMilli('area', { count: '2', length: '4.3', width: '0.45' })).toBe(3_870);
    expect(quantityMilli('volume', { length: '1.5', width: '0.23', height: '2.8' })).toBe(966);
    expect(quantityMilli('quantity', { quantity: '483' })).toBe(483_000);
    expect(quantityMilli('length', { count: '3', length: '12.5' })).toBe(37_500);
  });

  it('gives the amount to the paisa, as the sheet does', () => {
    expect(amountPaise(966, 792_000)).toBe(765_072); // 0.966 M3 × ₹7,920 = ₹7,650.72
    expect(amountPaise(5_590, 60_000)).toBe(335_400);
  });

  it('names the box that is missing or wrong', () => {
    expect(() => quantityMilli('volume', { length: '1.5', width: '0.23' })).toThrow('height');
    expect(() => quantityMilli('area', { length: 'abc', width: '1' })).toThrow('length');
    expect(() => quantityMilli('area', { count: '0', length: '1', width: '1' })).toThrow('count');
    expect(() => quantityMilli('area', { length: '-1', width: '1' })).toThrow('length');
  });

  it('writes the measurement the way the report shows it', () => {
    expect(measurementText('area', { count: '2', length: '4.3', width: '0.45' })).toBe('2 × 4.3 × 0.45');
    expect(measurementText('volume', { count: '1', length: '1.5', width: '0.23', height: '2.8' })).toBe('1.5 × 0.23 × 2.8');
    expect(measurementText('quantity', { quantity: '483' })).toBe('483');
  });
});
