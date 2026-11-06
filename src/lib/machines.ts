export interface MachineService {
  id: string;
  service_date: string;
  running_hours: number | string;
  cost_paise: number | string;
  note: string;
  created_at?: string;
}

/** The latest service: by date, then by the higher meter reading if two share a date. */
export function lastService<T extends Pick<MachineService, 'service_date' | 'running_hours'>>(services: T[]): T | undefined {
  return [...services].sort((a, b) => a.service_date.localeCompare(b.service_date) || Number(a.running_hours) - Number(b.running_hours)).at(-1);
}

/** The meter reading at which the next service falls due. */
export const nextServiceAt = (lastHours: number | string, everyHours: number): number =>
  Math.round((Number(lastHours) + everyHours) * 10) / 10;

export const totalCost = (services: Pick<MachineService, 'cost_paise'>[]): number =>
  services.reduce((sum, s) => sum + Number(s.cost_paise), 0);

/** Running hours for the screen: 12,500.5 (Indian grouping). */
export const showHours = (hours: number | string): string => Number(hours).toLocaleString('en-IN', { maximumFractionDigits: 1 });
