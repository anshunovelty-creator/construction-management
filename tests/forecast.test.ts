import { describe, expect, it } from 'vitest';
import { dayOfMonth, forecast, nextDay, planDates, shortages, stillDue, taxDue } from '@/lib/forecast';

describe('what is still due', () => {
  it('settles the oldest bill first, and adds the days of credit', () => {
    const bills = [{ date: '2026-11-10', amount: 500 }, { date: '2026-11-01', amount: 300 }];
    expect(stillDue(bills, 400, 30)).toEqual([{ date: '2026-12-10', amount: 400 }]);
    expect(stillDue(bills, 0, 0)).toEqual([{ date: '2026-11-01', amount: 300 }, { date: '2026-11-10', amount: 500 }]);
    expect(stillDue(bills, 900, 0)).toEqual([]);
    // An opening balance of extra paid (a minus) pays the next bill.
    expect(stillDue([{ date: '2026-10-01', amount: -200 }, ...bills], 0, 0)).toEqual([{ date: '2026-11-01', amount: 100 }, { date: '2026-11-10', amount: 500 }]);
  });
});

describe('days', () => {
  it('finds the next day of a month, and clamps the 31st', () => {
    expect(nextDay('2026-11-24', 7)).toBe('2026-12-07');
    expect(nextDay('2026-11-24', 24)).toBe('2026-11-24');
    expect(dayOfMonth('2026-11-24', 31)).toBe('2026-11-30');
    expect(dayOfMonth('2026-12-24', 20, 1)).toBe('2027-01-20');
  });

  it('repeats a plan by the week or month until its end, skipping what is past, and keeps a one-time one due', () => {
    const plan = { direction: 'out' as const, amount_paise: 1, until_on: null };
    expect(planDates({ ...plan, repeats: 'month', next_on: '2026-10-31' }, '2026-11-24', '2027-01-18')).toEqual(['2026-11-30', '2026-12-31']);
    expect(planDates({ ...plan, repeats: 'week', next_on: '2026-11-20', until_on: '2026-12-05' }, '2026-11-24', '2027-01-18')).toEqual(['2026-11-27', '2026-12-04']);
    expect(planDates({ ...plan, repeats: 'once', next_on: '2026-11-01' }, '2026-11-24', '2027-01-18')).toEqual(['2026-11-01']);
    expect(planDates({ ...plan, repeats: 'once', next_on: '2027-03-01' }, '2026-11-24', '2027-01-18')).toEqual([]);
  });
});

describe('the weeks ahead', () => {
  it('carry on from each other, with what is overdue in the first', () => {
    const weeks = forecast(1000, [
      { date: '2026-11-01', kind: 'parties', amount: -700 }, { date: '2026-11-30', kind: 'parties', amount: -100 },
      { date: '2026-12-01', kind: 'clients', amount: 500 }, { date: '2027-03-01', kind: 'clients', amount: 9 },
    ], '2026-11-24');
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toMatchObject({ from: '2026-11-24', to: '2026-11-30', opening: 1000, out: 800, closing: 200, kinds: { parties: -800 } });
    expect(weeks[1]).toMatchObject({ opening: 200, in: 500, closing: 700 });
    expect(weeks[7]!.closing).toBe(700);
  });

  it('names a firm that runs short and who has spare: the least they hold from that week on', () => {
    const item = (date: string, amount: number) => ({ date, kind: 'parties' as const, amount });
    const jayraj = forecast(100, [item('2026-12-02', -500)], '2026-11-24');
    const ab = forecast(900, [item('2026-12-20', -300)], '2026-11-24');
    expect(shortages([{ name: 'Jayraj', weeks: jayraj }, { name: 'AB', weeks: ab }])).toEqual([{ name: 'Jayraj', week: 1, short: 400, spare: [{ name: 'AB', amount: 600 }] }]);
  });
});

describe('tax', () => {
  it('is due for months that are over, and this month’s later; credit from before comes off this month’s', () => {
    const rows = [{ month: '2026-10', amount: 100 }, { month: '2026-11', amount: 50 }];
    expect(taxDue(rows, 30, '2026-11')).toEqual({ past: 70, now: 50 });
    expect(taxDue(rows, 120, '2026-11')).toEqual({ past: 0, now: 30 });
    expect(taxDue([{ month: '2026-10', amount: -80 }, { month: '2026-11', amount: 50 }], 0, '2026-11')).toEqual({ past: 0, now: 0 });
  });
});
