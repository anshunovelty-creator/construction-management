import { ENUMS } from '@/lib/masters/registry';

/** How a unit is measured (Setup → Units): by its quantity, or by length, length × width, or length × width × height. */
export type Measure = (typeof ENUMS.unit_measure)[number];

/** The boxes a measurement line has for each kind of unit, after "No." (how many alike). */
export const DIMENSIONS: Record<Measure, readonly ('length' | 'width' | 'height' | 'quantity')[]> = {
  quantity: ['quantity'],
  length: ['length'],
  area: ['length', 'width'],
  volume: ['length', 'width', 'height'],
};

export type MeasurementLine = Partial<Record<'count' | 'length' | 'width' | 'height' | 'quantity', string>>;

const NUMBER = /^(\d+(\.\d*)?|\.\d+)$/;

/**
 * The quantity of one measurement line in thousandths (3 decimals, like the site sheet): No. × each dimension.
 * No. left empty is 1. Throws the name of the first box that is empty or not a number above zero.
 */
export function quantityMilli(measure: Measure, line: MeasurementLine): number {
  let value = 1;
  for (const box of ['count', ...DIMENSIONS[measure]] as const) {
    const text = (line[box] ?? '').trim();
    if (box === 'count' && text === '') continue;
    if (!NUMBER.test(text) || Number(text) <= 0) throw new Error(box);
    value *= Number(text);
  }
  return Math.round(value * 1000);
}

/** The amount in paise: whole numbers until the last step, so it matches the database's check to the paisa. */
export const amountPaise = (milli: number, ratePaise: number): number => Math.round((milli * ratePaise) / 1000);

/** How the line is written in the report: "2 × 4.3 × 0.45", or just the quantity for Nos, Bags and the like. */
export function measurementText(measure: Measure, line: MeasurementLine): string {
  const count = (line.count ?? '').trim();
  const parts = DIMENSIONS[measure].map((box) => (line[box] ?? '').trim());
  return [...(count && count !== '1' ? [count] : []), ...parts].join(' × ');
}
