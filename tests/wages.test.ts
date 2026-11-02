import { expect, it } from 'vitest';
import { dayAmount, dayPay, lastMonth, otCenti, salaryPeriod, salaryTotals, staffSalary } from '@/lib/wages';

it('pays a worker 8 hours a day with OT at a day ÷ 8; staff cost a site a day\'s share of their month', () => {
  expect(dayPay('worker', 6_500, '2026-11-02')).toBe(52_000);
  expect(dayAmount(true, otCenti('2'), dayPay('worker', 6_500, '2026-11-02'))).toBe(65_000);
  expect(dayPay('staff', 2_000_000, '2026-11-02')).toBe(66_667); // ₹20,000 ÷ 30 days
  expect(dayPay('staff', 2_000_000, '2026-02-10')).toBe(71_429); // ÷ 28
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

it('keeps staff salary fixed: the whole month whatever the attendance, by calendar days for part of a month', () => {
  expect(staffSalary(2_000_000, '2026-11-01', '2026-11-30')).toBe(2_000_000);
  expect(staffSalary(2_000_000, '2026-02-01', '2026-02-28')).toBe(2_000_000);
  expect(staffSalary(2_000_000, '2026-11-01', '2026-11-15')).toBe(1_000_000);
  expect(staffSalary(2_000_000, '2026-10-01', '2026-11-30')).toBe(4_000_000);
  expect(staffSalary(3_100_000, '2026-10-17', '2026-11-15')).toBe(1_500_000 + 1_550_000);
});
