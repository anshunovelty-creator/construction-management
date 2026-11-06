import { expect, it } from 'vitest';
import { lastService, nextServiceAt, showHours, totalCost } from '@/lib/machines';

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
