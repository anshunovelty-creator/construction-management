import { expect, it } from 'vitest';
import { familyLedger, labourLedger, rateFor, ratesToSave, salaryFor, type LabourMonth } from '@/lib/labour';

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

it('adds up a family at each member\'s own salary, takes the head\'s dated money off in its month, and carries it on', () => {
  const day800 = [{ from_month: '2026-01-01', rate_paise: 80_000 }];
  // Head: 25 days at ₹1,000 = ₹25,000. Wife: 20 days and 8 OT hours at ₹800 = ₹16,000 + ₹800. Oct comes to ₹41,800.
  const [oct, nov] = familyLedger([
    { months: [month('2026-10', { present_days: 25 }), month('2026-11', { present_days: 10 })], rates: day1000 },
    { months: [month('2026-10', { present_days: 20, ot_hours: 8 })], rates: day800 },
  ], [
    { money_date: '2026-10-05', kind: 'advance', amount_paise: 500_000 },
    { money_date: '2026-10-20', kind: 'deduction', amount_paise: 100_000 },
    { money_date: '2026-10-31', kind: 'payment', amount_paise: 4_000_000 },
    { money_date: '2026-11-30', kind: 'payment', amount_paise: 500_000 },
  ]);
  // ₹41,800 − ₹5,000 advance − ₹1,000 deduction − ₹40,000 paid leaves ₹4,200 extra paid; Nov ₹10,000 less that less ₹5,000 paid is ₹800.
  expect(oct).toMatchObject({ month: '2026-10', days: 45, otHours: 8, salary: 4_180_000, advance: 500_000, deduction: 100_000, paid: 4_000_000, balance: -420_000 });
  expect(nov).toMatchObject({ month: '2026-11', days: 10, salary: 1_000_000, before: -420_000, paid: 500_000, balance: 80_000 });
});

it('counts a family\'s opening balance in its month\'s "from last month" and carries it on', () => {
  const head = { months: [month('2026-11', { present_days: 10, paid_paise: 500_000 })], rates: day1000 };
  // ₹2,000 still owed from before the app: Nov ₹10,000 + ₹2,000 − ₹5,000 paid leaves ₹7,000.
  const [nov] = familyLedger([head], [], { month: '2026-11-01', amount_paise: 200_000 });
  expect(nov).toMatchObject({ opening: 200_000, before: 200_000, balance: 700_000 });
  // ₹3,000 paid extra, counted from October with nothing typed then: October leaves it, and November takes it off.
  const [oct, nov2] = familyLedger([head], [], { month: '2026-10-01', amount_paise: -300_000 });
  expect(oct).toMatchObject({ month: '2026-10', opening: -300_000, before: -300_000, balance: -300_000 });
  expect(nov2).toMatchObject({ opening: 0, before: -300_000, balance: 200_000 });
});

it('keeps earlier months at their salary when the first salary is changed from its own month', () => {
  const have = [{ worker_id: 'w', from_month: '2026-11-01', rate_paise: 100_000 }];
  const change = { worker_id: 'w', from_month: '2026-11-01', rate_paise: 110_000 };
  const saved = ratesToSave(have, [change]);
  expect(saved).toEqual([{ worker_id: 'w', from_month: '2026-10-01', rate_paise: 100_000 }, change]);
  // October (borrowed the earliest) stays ₹1,000; November on is ₹1,100. A January change keeps December too.
  expect([rateFor(saved, '2026-09'), rateFor(saved, '2026-10'), rateFor(saved, '2026-11'), rateFor(saved, '2026-12')]).toEqual([100_000, 100_000, 110_000, 110_000]);
  expect(ratesToSave([{ worker_id: 'w', from_month: '2027-01-01', rate_paise: 1 }], [{ worker_id: 'w', from_month: '2027-01-01', rate_paise: 2 }])[0]!.from_month).toBe('2026-12-01');
  // With a salary already counting from before, nothing more is needed.
  expect(ratesToSave(saved, [{ worker_id: 'w', from_month: '2026-12-01', rate_paise: 120_000 }])).toHaveLength(1);
});
