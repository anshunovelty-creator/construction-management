import { expect, it } from 'vitest';
import { rentDays, rentPaise } from '@/lib/rent';

it('runs the rent meter from the day rented to the day returned', () => {
  expect(rentDays('2026-11-02', '2026-11-12')).toBe(10);
  expect(rentDays('2026-10-28', '2026-11-02')).toBe(5); // across a month end
  expect(rentDays('2026-11-02', '2026-11-02')).toBe(1); // back the same day is still a day
  // 10 shuttering plates at ₹0.75 a day for 10 days = ₹75.
  expect(rentPaise(10_000, 75, 10)).toBe(7_500);
  expect(rentPaise(2_500, 75, 3)).toBe(563); // 2.5 × 0.75 × 3 = ₹5.625 → ₹5.63
});
