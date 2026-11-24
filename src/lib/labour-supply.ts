import { rateFor, salaryFor, type LabourRate } from '@/lib/labour';
import type { Paise } from '@/lib/money';

/** What a day is charged at from a month on; null goes back to the day's salary. */
export interface ChargeRate { from_month: string; rate_paise: number | string | null }

/** The day's charged rate for a month ("2026-11"): the latest kept from that month or before, else the day's salary. */
export function chargeFor(charges: ChargeRate[], rates: LabourRate[], month: string): Paise {
  const last = [...charges].sort((a, b) => a.from_month.localeCompare(b.from_month)).filter((c) => c.from_month.slice(0, 7) <= month).at(-1);
  return last?.rate_paise ? Number(last.rate_paise) : rateFor(rates, month);
}

export interface PlaceDays { place_id: string; days: number | string; ot_hours: number | string }
export interface Placed { placeId: string; days: number; ot: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Where a worker's month was spent. Nothing said: all at the usual place. One place: all of it there, however the days
 * change later. Several: the days typed for each; `days` and `ot` are then what has no place yet (below zero, too many).
 */
export function placeMonth(total: { days: number; ot: number }, said: PlaceDays[], usual: string | null): { at: Placed[]; days: number; ot: number } {
  if (said.length > 1) {
    const at = said.map((p) => ({ placeId: p.place_id, days: Number(p.days), ot: Number(p.ot_hours) }));
    return {
      at,
      days: round2(total.days - at.reduce((s, p) => s + p.days, 0)),
      ot: round2(total.ot - at.reduce((s, p) => s + p.ot, 0)),
    };
  }
  const only = said[0]?.place_id ?? usual;
  return only ? { at: [{ placeId: only, ...total }], days: 0, ot: 0 } : { at: [], ...total };
}

export interface SupplyWorker {
  id: string;
  days: number;
  ot: number;
  rates: LabourRate[];
  charges: ChargeRate[];
  usual: string | null;
  said: PlaceDays[];
}

/** What each place is charged for a month, what its workers earn for it, and how much of the month has no place. */
export function supplied(workers: SupplyWorker[], month: string): { places: Map<string, { days: number; ot: number; charged: Paise; paid: Paise }>; unplaced: string[] } {
  const places = new Map<string, { days: number; ot: number; charged: Paise; paid: Paise }>();
  const unplaced: string[] = [];
  for (const w of workers) {
    const { at, days, ot } = placeMonth({ days: w.days, ot: w.ot }, w.said, w.usual);
    if (days !== 0 || ot !== 0) unplaced.push(w.id);
    const [charge, rate] = [chargeFor(w.charges, w.rates, month), rateFor(w.rates, month)];
    for (const p of at) {
      const sum = places.get(p.placeId) ?? { days: 0, ot: 0, charged: 0, paid: 0 };
      sum.days = round2(sum.days + p.days);
      sum.ot = round2(sum.ot + p.ot);
      sum.charged += salaryFor(p.days, p.ot, charge);
      sum.paid += salaryFor(p.days, p.ot, rate);
      places.set(p.placeId, sum);
    }
  }
  return { places, unplaced };
}
