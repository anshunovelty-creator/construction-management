import { expect, it } from 'vitest';
import { dayAmount, dayPay, lastMonth, otCenti, salaryPeriod, salaryTotals } from '@/lib/wages';

it('pays a worker 8 hours a day and staff their day rate, with OT at a day ÷ 8', () => {
  expect(dayPay('worker', 6_500)).toBe(52_000);
  expect(dayAmount(true, otCenti('2'), dayPay('worker', 6_500))).toBe(65_000);
  expect(dayAmount(true, otCenti('1.5'), dayPay('staff', 130_000))).toBe(154_375);
  expect(dayAmount(false, 0, 52_000)).toBe(0);
  expect(otCenti('')).toBe(0);
  expect(() => otCenti('17')).toThrow();
  expect(() => otCenti('abc')).toThrow();
});

it('finds the salary period, and adds up days, OT and pay', () => {
  expect(salaryPeriod({ month: '2026-02' }, '2026-10-31')).toEqual({ from: '2026-02-01', to: '2026-02-28', month: '2026-02' });
  expect(salaryPeriod({ from: '2026-10-01', to: '2026-10-07' }, '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
  expect(salaryPeriod({ from: '2026-10-07', to: '2026-10-01' }, '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
  expect(salaryPeriod({}, '2026-10-18')).toEqual({ from: '2026-10-01', to: '2026-10-18', month: '2026-10' });
  expect(lastMonth('2026-01')).toBe('2025-12');
  expect(salaryTotals([
    { present: true, ot_hours: '2', day_pay_paise: 52_000, amount_paise: 65_000 },
    { present: false, ot_hours: '0', day_pay_paise: 52_000, amount_paise: 0 },
    { present: true, ot_hours: '0', day_pay_paise: 52_000, amount_paise: 52_000 },
  ])).toEqual({ present: 2, absent: 1, otHours: 2, dayPaise: 104_000, otPaise: 13_000, totalPaise: 117_000 });
});
