import { expect, it } from 'vitest';
import { buildStatement, tallyFoot } from '@/lib/ledger/statement';

const rows = [
  { date: '2026-10-01', debit: 1_000, credit: 0 },
  { date: '2026-10-05', debit: 0, credit: 300 },
  { date: '2026-10-10', debit: 500, credit: 0 },
  { date: '2026-10-20', debit: 0, credit: 700 },
];

it('runs the balance down every row when no dates are given', () => {
  const s = buildStatement(rows);
  expect(s.lines.map((l) => l.balance)).toEqual([1_000, 700, 1_200, 500]);
  expect(s).toMatchObject({ opening: 0, debit: 1_500, credit: 1_000, closing: 500 });
});

it('brings earlier rows forward as the opening balance and leaves out later ones', () => {
  const s = buildStatement(rows, '2026-10-05', '2026-10-10');
  expect(s.opening).toBe(1_000);
  expect(s.lines.map((l) => [l.date, l.balance])).toEqual([['2026-10-05', 700], ['2026-10-10', 1_200]]);
  expect(s).toMatchObject({ debit: 500, credit: 300, closing: 1_200 });
});

it('keeps the opening as the closing when nothing falls in the period', () => {
  const s = buildStatement(rows, '2026-11-01');
  expect(s).toMatchObject({ opening: 500, lines: [], closing: 500 });
});

it('closes like Tally: the balance goes on the other side so both columns total the same', () => {
  // Client: ₹1,000 owed at the start (Dr), billed ₹500, received ₹1,200 → ₹300 still owed (Dr), closed on the Cr side.
  expect(tallyFoot({ opening: 100_000, debit: 50_000, credit: 120_000 }))
    .toEqual({ debit: 150_000, credit: 120_000, closingDebit: 0, closingCredit: 30_000, total: 150_000 });
  // Vendor: ₹800 owed at the start (Cr), paid ₹200 → ₹600 still owed (Cr), closed on the Dr side.
  expect(tallyFoot({ opening: -80_000, debit: 20_000, credit: 0 }))
    .toEqual({ debit: 20_000, credit: 80_000, closingDebit: 60_000, closingCredit: 0, total: 80_000 });
});
