import { describe, expect, it } from 'vitest';
import { stockLines, valueOf } from '@/lib/stock';

const sand = { site_id: 'svg', material_id: 'sand' };

describe('stock', () => {
  it('takes what was used from what was bought, at the average purchase rate', () => {
    const [line] = stockLines(
      [
        { ...sand, entry_date: '2026-10-10', quantity: '2.000', amount_paise: 200_000 }, // ₹1,000 a ton
        { ...sand, entry_date: '2026-10-12', quantity: '1.000', amount_paise: 130_000 }, // ₹1,300 a ton
      ],
      [{ ...sand, use_date: '2026-10-18', quantity: '0.45' }, { ...sand, use_date: '2026-10-18', quantity: '0.1' }],
    );
    expect(line).toEqual({ ...sand, bought: 3, used: 0.55, left: 2.45, rate: 110_000 });
    expect(valueOf(0.45, line!.rate)).toBe(49_500);
  });

  it('goes below zero when more is used than bought, and counts only up to a report’s day', () => {
    const bought = [{ ...sand, entry_date: '2026-10-20', quantity: 5, amount_paise: 500_000 }];
    const used = [{ ...sand, use_date: '2026-10-18', quantity: 1 }];
    expect(stockLines(bought, used, '2026-10-18')).toEqual([{ ...sand, bought: 0, used: 1, left: -1, rate: null }]);
    expect(valueOf(1, null)).toBe(0);
  });
});
