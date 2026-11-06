import { expect, it } from 'vitest';
import { labourLedger, rateFor, salaryFor, type LabourMonth } from '@/lib/labour';

const day1000 = [{ from_month: '2026-01-01', rate_paise: 100_000 }];
const month = (m: string, fields: Partial<LabourMonth>): LabourMonth => ({
  month: `${m}-01`, present_days: 0, ot_hours: 0, advance_paise: 0, deduction_paise: 0, addition_paise: 0, paid_paise: 0, ...fields,
});

it('pays days at the day salary and OT hours at a day ÷ 8, and takes more days than the month has', () => {
  expect(salaryFor(25, 0, 100_000)).toBe(2_500_000);
  expect(salaryFor(35, 0, 100_000)).toBe(3_500_000); // double duties
  expect(salaryFor('25.5', '10', 100_000)).toBe(2_550_000 + 125_000);
  expect(salaryFor(0, '1', 66_700)).toBe(8_338); // ₹83.375 to the nearest paisa
});

it('shows paying more than the month came to as extra paid, then cuts it from the next salary', () => {
  // ₹25,000 less a ₹2,000 advance is ₹23,000; ₹30,000 paid leaves ₹7,000 extra. Next month ₹20,000 less that is ₹13,000.
  const [oct, nov] = labourLedger([
    month('2026-11', { present_days: 20 }),
    month('2026-10', { present_days: 25, advance_paise: 200_000, paid_paise: 3_000_000 }),
  ], day1000);
  expect(oct).toMatchObject({ month: '2026-10', salary: 2_500_000, net: 2_300_000, before: 0, balance: -700_000 });
  expect(nov).toMatchObject({ month: '2026-11', salary: 2_000_000, net: 2_000_000, before: -700_000, balance: 1_300_000 });
});

it('counts a deduction and an addition in the month', () => {
  const [m] = labourLedger([month('2026-10', { present_days: 10, deduction_paise: 50_000, addition_paise: 20_000, paid_paise: 500_000 })], day1000);
  expect(m).toMatchObject({ salary: 1_000_000, net: 970_000, balance: 470_000 });
});

it('keeps past months at the day salary of their time', () => {
  const rates = [...day1000, { from_month: '2026-11-01', rate_paise: 120_000 }];
  expect(rateFor(rates, '2026-10')).toBe(100_000);
  expect(rateFor(rates, '2026-11')).toBe(120_000);
  expect(rateFor(rates, '2025-12')).toBe(100_000); // before the first rate: the first, not ₹0
  expect(labourLedger([month('2026-10', { present_days: 1 }), month('2026-12', { present_days: 1 })], rates).map((m) => m.salary)).toEqual([100_000, 120_000]);
});

it('drops a remainder under ₹1 and carries nothing of it to the next month', () => {
  const [oct, nov] = labourLedger([
    month('2026-10', { present_days: 1, paid_paise: 100_050 }),
    month('2026-11', { present_days: 1, paid_paise: 100_000 }),
  ], day1000);
  expect(oct!.balance).toBe(0);
  expect(nov).toMatchObject({ before: 0, balance: 0 });
});
