import { expect, it } from 'vitest';
import { buildStatement } from '@/lib/ledger/statement';

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
