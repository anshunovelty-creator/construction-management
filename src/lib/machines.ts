/** A line of a machine's record: a service, or one of its papers (owner decision 2026-11-26). Empty kind = a service. */
export type Paper = 'insurance' | 'puc' | 'fitness';
export const PAPERS: Paper[] = ['insurance', 'puc', 'fitness'];
/** Their names, also used in a payment's narration. */
export const PAPER_NAMES: Record<Paper, string> = { insurance: 'Insurance', puc: 'PUC', fitness: 'Fitness' };

export interface MachineService {
  id: string;
  service_date: string;
  /** Empty for a paper. */
  running_hours: number | string | null;
  cost_paise: number | string;
  note: string;
  kind?: 'service' | Paper | null;
  paper_no?: string | null;
  company?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  created_at?: string;
}

export const isService = (line: Pick<MachineService, 'kind'>): boolean => !line.kind || line.kind === 'service';

/** The latest service: by date, then by the higher meter reading if two share a date. Papers are left out. */
export function lastService<T extends Pick<MachineService, 'service_date' | 'running_hours' | 'kind'>>(services: T[]): T | undefined {
  return services.filter(isService).sort((a, b) => a.service_date.localeCompare(b.service_date) || Number(a.running_hours) - Number(b.running_hours)).at(-1);
}

/** The paper of this kind that runs the longest (a renewal bought early counts from when it starts). */
export function latestPaper<T extends Pick<MachineService, 'kind' | 'valid_until'>>(lines: T[], paper: Paper): T | undefined {
  return lines.filter((l) => l.kind === paper && l.valid_until).sort((a, b) => a.valid_until!.localeCompare(b.valid_until!)).at(-1);
}

/** Days left on a paper from today: below zero when it has run out. Dates are YYYY-MM-DD. */
export const daysLeft = (validUntil: string, today: string): number =>
  Math.round((Date.parse(validUntil) - Date.parse(today)) / 86_400_000);

/** A paper is fine, runs out within 30 days, or has run out (the day it is valid until still counts). */
export function paperState(validUntil: string | undefined, today: string): 'none' | 'ok' | 'soon' | 'out' {
  if (!validUntil) return 'none';
  const left = daysLeft(validUntil, today);
  return left < 0 ? 'out' : left <= 30 ? 'soon' : 'ok';
}

/** The meter reading at which the next service falls due. */
export const nextServiceAt = (lastHours: number | string | null, everyHours: number): number =>
  Math.round((Number(lastHours) + everyHours) * 10) / 10;

export const totalCost = (services: Pick<MachineService, 'cost_paise'>[]): number =>
  services.reduce((sum, s) => sum + Number(s.cost_paise), 0);

/** Running hours for the screen: 12,500.5 (Indian grouping). */
export const showHours = (hours: number | string | null): string => Number(hours).toLocaleString('en-IN', { maximumFractionDigits: 1 });
