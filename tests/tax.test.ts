import { expect, it } from 'vitest';
import { gstLeft, taxDue } from '@/lib/tax';

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

it('counts tax due for months that are over and this one; credit from before comes off this month’s', () => {
  const rows = [{ month: '2026-10', amount: 100 }, { month: '2026-11', amount: 50 }];
  expect(taxDue(rows, 30, '2026-11')).toBe(120);
  expect(taxDue(rows, 120, '2026-11')).toBe(30);
  expect(taxDue([{ month: '2026-10', amount: -80 }, { month: '2026-11', amount: 50 }], 0, '2026-11')).toBe(0);
  expect(taxDue([{ month: '2026-10', amount: 80 }, { month: '2026-11', amount: -50 }], 0, '2026-11')).toBe(80);
});
