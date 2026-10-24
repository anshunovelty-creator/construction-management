import { expect, it } from 'vitest';
import { partyFigures, sumFigures } from '@/lib/ledger/party';

const row = (opening: number, bills: number, paid: number) =>
  partyFigures({ opening_paise: opening, bills_paise: String(bills), paid_paise: paid, last_payment: null });

it('follows the workbook: total = opening + bills, balance = total - paid, and its Status rule', () => {
  expect(row(1000, 500, 0)).toMatchObject({ total: 1500, balance: 1500, percentPaid: 0, status: 'pending' });
  expect(row(1000, 500, 600)).toMatchObject({ balance: 900, percentPaid: 40, status: 'partPaid' });
  expect(row(1000, 0, 1000)).toMatchObject({ balance: 0, percentPaid: 100, status: 'cleared' });
  // Paid more than owed: an advance, still cleared.
  expect(row(0, 0, 200)).toMatchObject({ balance: -200, percentPaid: 0, status: 'cleared' });
  expect(sumFigures([row(1000, 500, 600), row(1000, 0, 1000)])).toEqual({
    opening: 2000, bills: 500, total: 2500, paid: 1600, balance: 900, percentPaid: 64,
  });
});
