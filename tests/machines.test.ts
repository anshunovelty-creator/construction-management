import { expect, it } from 'vitest';
import { daysLeft, lastService, latestPaper, nextServiceAt, paperState, showHours, totalCost } from '@/lib/machines';

const service = (service_date: string, running_hours: number | string, cost_paise: number | string = 0) => ({ service_date, running_hours, cost_paise });

it('finds the latest service by date, whatever order they were typed in', () => {
  expect(lastService([service('2026-10-01', 1000), service('2026-11-01', 1500), service('2026-09-01', 500)])?.running_hours).toBe(1500);
  expect(lastService([service('2026-11-01', 1500), service('2026-11-01', 1600)])?.running_hours).toBe(1600);
  expect(lastService([])).toBeUndefined();
});

it('keeps a replaced meter: the latest date counts even with fewer hours', () => {
  expect(lastService([service('2026-10-01', 9000), service('2026-11-01', 20)])?.running_hours).toBe(20);
});

it('puts the next service at the last reading plus the hours between services', () => {
  expect(nextServiceAt('1500.0', 500)).toBe(2000);
  expect(nextServiceAt('1234.5', 500)).toBe(1734.5);
  expect(nextServiceAt('0.1', 250)).toBe(250.1);
});

it('adds up the cost and shows hours in Indian grouping', () => {
  expect(totalCost([service('2026-10-01', 0, 1_250_000), service('2026-11-01', 0, '850050')])).toBe(2_100_050);
  expect(showHours('125000.5')).toBe('1,25,000.5');
  expect(showHours('500.0')).toBe('500');
});

it('leaves papers out of the last service, and finds the paper that runs longest', () => {
  const paper = (kind: 'insurance' | 'puc', valid_until: string) => ({ service_date: '2026-12-01', running_hours: null, kind, valid_until });
  expect(lastService([service('2026-10-01', 1000), paper('insurance', '2027-11-30')])?.running_hours).toBe(1000);
  const lines = [paper('insurance', '2026-12-10'), paper('insurance', '2027-12-09'), paper('puc', '2027-06-01')];
  expect(latestPaper(lines, 'insurance')?.valid_until).toBe('2027-12-09');
  expect(latestPaper(lines, 'fitness')).toBeUndefined();
});

it('says whether a paper is fine, runs out within 30 days, or has run out', () => {
  expect(daysLeft('2026-12-26', '2026-11-26')).toBe(30);
  expect(paperState('2026-12-26', '2026-11-26')).toBe('soon');
  expect(paperState('2026-12-27', '2026-11-26')).toBe('ok');
  expect(paperState('2026-11-26', '2026-11-26')).toBe('soon');
  expect(paperState('2026-11-25', '2026-11-26')).toBe('out');
  expect(paperState(undefined, '2026-11-26')).toBe('none');
});
