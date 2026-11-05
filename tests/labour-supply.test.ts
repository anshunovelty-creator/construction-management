import { expect, it } from 'vitest';
import { labourLedger, monthPay, type LabourPerson, type LabourSettings } from '@/lib/labour';

const settings: LabourSettings[] = [{ from_month: '2000-01-01', pf_bp: 1200, pf_ceiling_paise: 1_500_000, esic_bp: 75, esic_limit_paise: 2_100_000, ot_percent: 100 }];
const worker: LabourPerson = { kind: 'worker', joined_on: '2026-01-01', left_on: null, pf_on: true, esic_on: true };
const staff: LabourPerson = { ...worker, kind: 'staff' };
const day800 = [{ from_month: '2026-01-01', rate_paise: 80_000 }];
const money = (id: string, money_date: string, kind: 'advance' | 'payment' | 'deduction', amount_paise: number) => ({ id, money_date, kind, amount_paise });

it('pays a worker for days and OT, with PF on the days only and ESIC on the whole', () => {
  // 25 days at ₹800 = ₹20,000; 10 OT hours at ₹100 = ₹1,000. PF: 12% of the ₹15,000 ceiling. ESIC: 0.75% of ₹21,000, up to the rupee.
  expect(monthPay(worker, day800, settings, { present: 25, absent: 5, ot_hours: '10' }, '2026-10', '2026-11-05')).toMatchObject({
    dayPaise: 2_000_000, otPaise: 100_000, earned: 2_100_000, pf: 180_000, esic: 15_800, net: 1_904_200,
  });
});

it('leaves ESIC off above the limit, respects each switch, and pays OT at the percent set', () => {
  expect(monthPay(worker, day800, settings, { present: 27, absent: 0, ot_hours: 0 }, '2026-10', '2026-11-05')).toMatchObject({ earned: 2_160_000, esic: 0 });
  expect(monthPay({ ...worker, pf_on: false, esic_on: false }, day800, settings, { present: 10, absent: 0, ot_hours: 0 }, '2026-10', '2026-11-05')).toMatchObject({ pf: 0, esic: 0, net: 800_000 });
  expect(monthPay(worker, day800, [{ ...settings[0]!, ot_percent: 200 }], { present: 0, absent: 0, ot_hours: '1.5' }, '2026-10', '2026-11-05').otPaise).toBe(30_000);
});

it('keeps past months at the rate and deductions of their time', () => {
  const rates = [...day800, { from_month: '2026-11-01', rate_paise: 100_000 }];
  const later = [...settings, { ...settings[0]!, from_month: '2026-11-01', pf_bp: 1000 }];
  const days = { present: 10, absent: 0, ot_hours: 0 };
  expect(monthPay(worker, rates, later, days, '2026-10', '2026-11-30')).toMatchObject({ dayPaise: 800_000, pf: 96_000 });
  expect(monthPay(worker, rates, later, days, '2026-11', '2026-11-30')).toMatchObject({ dayPaise: 1_000_000, pf: 100_000 });
});

it('pays staff the fixed salary whatever the attendance, with no OT, building up by day in the running month', () => {
  const salary = [{ from_month: '2026-01-01', rate_paise: 3_000_000 }];
  expect(monthPay(staff, salary, settings, { present: 3, absent: 20, ot_hours: '9' }, '2026-10', '2026-11-05')).toMatchObject({ dayPaise: 3_000_000, otPaise: 0, pf: 180_000, esic: 0 });
  expect(monthPay(staff, salary, settings, { present: 0, absent: 0, ot_hours: 0 }, '2026-11', '2026-11-15').dayPaise).toBe(1_500_000);
  expect(monthPay({ ...staff, joined_on: '2026-11-16' }, salary, settings, { present: 0, absent: 0, ot_hours: 0 }, '2026-11', '2026-11-30').dayPaise).toBe(1_500_000);
});

it('decides ESIC for staff on the monthly salary, not on what has built up so far in the month', () => {
  const none = { present: 0, absent: 0, ot_hours: 0 };
  expect(monthPay(staff, [{ from_month: '2026-01-01', rate_paise: 3_000_000 }], settings, none, '2026-11', '2026-11-05')).toMatchObject({ earned: 500_000, esic: 0 });
  // ₹18,000 a month is within the limit: 5/30 of it is ₹3,000, and 0.75% of that is ₹22.50, up to ₹23.
  expect(monthPay(staff, [{ from_month: '2026-01-01', rate_paise: 1_800_000 }], settings, none, '2026-11', '2026-11-05')).toMatchObject({ earned: 300_000, esic: 2_300 });
});

it('runs a worker ledger: earned less cuts, advances and payments, down to what is left', () => {
  const none = { pf_on: false, esic_on: false };
  const days = [{ month: '2026-09', present: 10, absent: 0, ot_hours: 0 }, { month: '2026-10', present: 5, absent: 0, ot_hours: 0 }];
  const lines = [money('a', '2026-09-15', 'advance', 100_000), money('p', '2026-10-05', 'payment', 700_000), money('c', '2026-10-31', 'deduction', 10_000)];
  const l = labourLedger({ ...worker, ...none }, day800, settings, days, lines, '2026-11-05');
  // The advance, then September's ₹8,000, the payment, October's ₹4,000 before the cut typed the same day.
  expect(l.rows.map((r) => [r.type, r.balance])).toEqual([
    ['advance', -100_000], ['salary', 700_000], ['payment', 0], ['salary', 400_000], ['deduction', 390_000],
  ]);
  expect(l).toMatchObject({ earned: 1_200_000, advances: 100_000, paid: 700_000, otherCuts: 10_000, balance: 390_000 });
});

it('goes below zero when more is paid than earned: that is extra paid', () => {
  const l = labourLedger({ ...worker, pf_on: false, esic_on: false }, day800, settings, [{ month: '2026-10', present: 1, absent: 0, ot_hours: 0 }], [money('a', '2026-10-02', 'advance', 100_000)], '2026-11-05');
  expect(l.balance).toBe(-20_000);
});

it('counts staff months from joining to leaving even with no attendance typed', () => {
  const none = { pf_on: false, esic_on: false };
  const salary = [{ from_month: '2026-09-01', rate_paise: 3_000_000 }];
  // September and October in full and half of November; then September and 15/31 of October.
  expect(labourLedger({ ...staff, ...none, joined_on: '2026-09-01' }, salary, settings, [], [], '2026-11-15').earned).toBe(7_500_000);
  expect(labourLedger({ ...staff, ...none, joined_on: '2026-09-01', left_on: '2026-10-15' }, salary, settings, [], [], '2026-11-15').earned).toBe(4_451_613);
});
