import { expect, it } from 'vitest';
import { amountDoubts } from '@/lib/doubts';

it('asks about more than what is left, and about a bank going below zero, but not about an advance', () => {
  expect(amountDoubts({ paise: 6_00_000, left: 60_000 })).toEqual(['more']);
  expect(amountDoubts({ paise: 60_000, left: 60_000 })).toEqual([]);
  expect(amountDoubts({ paise: 60_050, left: 60_000 })).toEqual([]);
  expect(amountDoubts({ paise: 60_000, left: 0 })).toEqual([]);
  expect(amountDoubts({ paise: 500, left: 900, before: 100, after: -400 })).toEqual(['overdrawn']);
  expect(amountDoubts({ paise: 500, before: -100, after: -600 })).toEqual([]);
});
