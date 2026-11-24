import { expect, it } from 'vitest';
import { gstLeft } from '@/lib/tax';

it('keeps what is to pay and the credit left over apart, firm by firm (the owner’s example: 2,05,000 and 40,000)', () => {
  const firms = [
    { owed: 3_60_000, claim: 1_80_000, paid: 0 }, // Jayraj
    { owed: 90_000, claim: 1_30_000, paid: 0 }, // AB
    { owed: 30_000, claim: 5_000, paid: 0 }, // Ansari
  ].map(gstLeft);
  expect(firms.reduce((s, f) => s + f.toPay, 0)).toBe(2_05_000);
  expect(firms.reduce((s, f) => s + f.credit, 0)).toBe(40_000);
  expect(gstLeft({ owed: 100, claim: 20, paid: 80 })).toEqual({ toPay: 0, credit: 0 });
});
