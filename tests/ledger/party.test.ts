import { expect, it } from 'vitest';
import { clientFigures, partyFigures, sumFigures } from '@/lib/ledger/party';

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

it('counts a client bill net of its deductions', () => {
  const f = clientFigures({
    firm_id: 'f', party_id: 'p', opening_paise: 2000, gross_paise: 10000, deductions_paise: 850, received_paise: 4000, last_receipt: null,
  });
  expect(f).toMatchObject({ opening: 2000, gross: 10000, deductions: 850, bills: 9150, total: 11150, paid: 4000, balance: 7150, status: 'partPaid' });
});
