import { expect, it } from 'vitest';
import { dayAmount, dayPay, lastMonth, otCenti, salaryPeriod, staffSalary } from '@/lib/wages';

it('pays a worker 8 hours a day with OT at a day ÷ 8; staff cost a site a day\'s share of their month', () => {
  expect(dayPay('worker', 6_500, '2026-11-02')).toBe(52_000);
  expect(dayAmount(true, otCenti('2'), dayPay('worker', 6_500, '2026-11-02'))).toBe(65_000);
  expect(dayPay('staff', 2_000_000, '2026-11-02')).toBe(66_667); // ₹20,000 ÷ 30 days
  expect(dayPay('staff', 2_000_000, '2026-02-10')).toBe(71_429); // ÷ 28
  expect(dayAmount(false, 0, 52_000)).toBe(0);
  expect(dayAmount(true, 0, 52_001, true)).toBe(26_001); // half day, rounded like the database
  expect(dayAmount(true, otCenti('1'), 52_000, true)).toBe(32_500); // OT stays a full day ÷ 8
  expect(otCenti('')).toBe(0);
  expect(() => otCenti('17')).toThrow();
  expect(() => otCenti('abc')).toThrow();
});

it('finds the salary period', () => {
  expect(salaryPeriod({ month: '2026-02' }, '2026-10-31')).toEqual({ from: '2026-02-01', to: '2026-02-28', month: '2026-02' });
  expect(salaryPeriod({ from: '2026-10-01', to: '2026-10-07' }, '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
  expect(salaryPeriod({ from: '2026-10-07', to: '2026-10-01' }, '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
  expect(salaryPeriod({}, '2026-10-18')).toEqual({ from: '2026-10-01', to: '2026-10-18', month: '2026-10' });
  expect(lastMonth('2026-01')).toBe('2025-12');
});

it('keeps staff salary fixed: the whole month whatever the attendance, by calendar days for part of a month', () => {
  expect(staffSalary(2_000_000, '2026-11-01', '2026-11-30')).toBe(2_000_000);
  expect(staffSalary(2_000_000, '2026-02-01', '2026-02-28')).toBe(2_000_000);
  expect(staffSalary(2_000_000, '2026-11-01', '2026-11-15')).toBe(1_000_000);
  expect(staffSalary(2_000_000, '2026-10-01', '2026-11-30')).toBe(4_000_000);
  expect(staffSalary(3_100_000, '2026-10-17', '2026-11-15')).toBe(1_500_000 + 1_550_000);
});

it('cuts PF from staff (not labour unless switched on), takes off advances and deductions, and carries what is left', async () => {
  const { pfCut, salaryLedger, salaryRow } = await import('@/lib/wages');
  expect(pfCut('staff', [], '2026-11')).toBe(true);
  expect(pfCut('worker', [], '2026-11')).toBe(false);
  const switches = [{ from_month: '2026-11-01', cut: true }];
  expect(pfCut('worker', switches, '2026-10')).toBe(false); // earlier months keep theirs
  expect(pfCut('worker', switches, '2026-12')).toBe(true);

  const staff = {
    kind: 'staff' as const, ratePaise: 2_000_000, from: '2026-10-01', to: '2026-11-30', months: [], pf: [], pfRates: [],
    money: [
      { money_date: '2026-10-05', kind: 'advance' as const, amount_paise: 500_000 },
      { money_date: '2026-10-31', kind: 'payment' as const, amount_paise: 1_500_000 },
      { money_date: '2026-11-03', kind: 'deduction' as const, amount_paise: 10_000 },
    ],
  };
  const [oct, nov] = salaryLedger(staff);
  // ₹20,000 − PF ₹2,400 − advance ₹5,000 = ₹12,600 net; ₹15,000 paid, so ₹2,400 paid extra comes off November.
  expect(oct).toMatchObject({ salary: 2_000_000, pf: 240_000, advance: 500_000, net: 1_260_000, paid: 1_500_000, balance: -240_000 });
  expect(nov).toMatchObject({ before: -240_000, net: 1_750_000, balance: 1_510_000 });
  expect(salaryRow(staff, '2026-11-01', '2026-11-30')).toMatchObject({ before: -240_000, balance: 1_510_000 });
  // From mid-month: the part before carries into "from before", and the end is the same.
  expect(salaryRow(staff, '2026-11-16', '2026-11-30').balance).toBe(1_510_000);

  const worker = {
    kind: 'worker' as const, ratePaise: 0, from: '2026-11-01', to: '2026-11-30', pf: [], pfRates: [],
    months: [{ month: '2026-11-01', days: '1', ot_hours: '2.5', salary_paise: '52000' }],
    money: [],
  };
  expect(salaryRow(worker, '2026-11-01', '2026-11-30')).toMatchObject({ days: 1, otHours: 2.5, salary: 52_000, pf: 0, balance: 52_000 });
  expect(salaryRow({ ...worker, pf: switches }, '2026-11-01', '2026-11-30')).toMatchObject({ pf: 6_240, balance: 45_760 });
});

it('counts an opening balance from before the app in its month, even before the first month typed, and carries it', async () => {
  const { salaryLedger, salaryRow } = await import('@/lib/wages');
  const worker = {
    kind: 'worker' as const, ratePaise: 0, from: '2026-11-01', to: '2026-11-30', pf: [], pfRates: [], money: [],
    months: [{ month: '2026-11-01', days: 1, ot_hours: 0, salary_paise: 52_000 }],
    opening: { month: '2026-10-01', amount_paise: 300_000 },
  };
  const [oct, nov] = salaryLedger(worker);
  expect(oct).toMatchObject({ month: '2026-10', opening: 300_000, before: 300_000, salary: 0, balance: 300_000 });
  expect(nov).toMatchObject({ opening: 0, before: 300_000, balance: 352_000 });
  expect(salaryRow(worker, '2026-10-01', '2026-10-31')).toMatchObject({ before: 300_000, balance: 300_000 });
  expect(salaryRow(worker, '2026-11-15', '2026-11-30')).toMatchObject({ before: 352_000, balance: 352_000 });
  // Paid extra before the app comes off the first salary.
  expect(salaryRow({ ...worker, opening: { month: '2026-11-01', amount_paise: -20_000 } }, '2026-11-01', '2026-11-30'))
    .toMatchObject({ before: -20_000, balance: 32_000 });
});

it('takes the PF rate from Setup, each counting from the month of its date, else 12%', async () => {
  const { pfRate } = await import('@/lib/wages');
  const rates = [{ from_date: '2026-01-01', rate_bp: 1200 }, { from_date: '2026-12-15', rate_bp: 1000 }];
  expect(pfRate([], '2026-11')).toBe(1200);
  expect(pfRate(rates, '2026-11')).toBe(1200); // earlier months keep theirs
  expect(pfRate(rates, '2026-12')).toBe(1000);
  expect(pfRate(rates, '2025-06')).toBe(1200);
});

it('offers a worker\'s pay per day from the last month typed, else the first one', async () => {
  const { payPerDay } = await import('@/lib/wages');
  const m = (month: string, day_pay_paise: string) => ({ month, days: 0, ot_hours: 0, salary_paise: 0, day_pay_paise });
  const months = [m('2026-12-01', '60000'), m('2026-10-01', '50000'), m('2026-11-01', '0')];
  expect(payPerDay(months, '2026-11')).toBe(50_000); // not typed: carries on
  expect(payPerDay(months, '2027-02')).toBe(60_000);
  expect(payPerDay(months, '2026-08')).toBe(50_000);
  expect(payPerDay([], '2026-11')).toBe(0);
});
