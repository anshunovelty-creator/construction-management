/** A material that arrived at a site (from stock_in_rows), or used on a daily report (from material_use). */
export interface Bought {
  site_id: string; material_id: string; entry_date: string; quantity: number | string;
  /** Quantity × rate; null when the supervisor did not know the rate. */
  amount_paise: number | string | null;
}
export interface Used { site_id: string; material_id: string; use_date: string; quantity: number | string }

export interface StockLine {
  site_id: string;
  material_id: string;
  bought: number;
  used: number;
  /** Bought less used; below zero when more was reported used than bought (a bill not entered yet). */
  left: number;
  /** Average rate before GST of what arrived with a rate, in paise per unit; null when none had one. */
  rate: number | null;
}

// Quantities are kept to 3 decimals; rounding stops 0.1 + 0.2 showing as 0.30000000000000004.
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Stock per site and material, whichever firm bought it. Only what happened up to `upTo` (a report's day) when given. */
export function stockLines(bought: Bought[], used: Used[], upTo?: string): StockLine[] {
  const lines = new Map<string, { site_id: string; material_id: string; bought: number; used: number; paid: number; priced: number }>();
  const line = (r: { site_id: string; material_id: string }) => {
    const k = `${r.site_id}|${r.material_id}`;
    if (!lines.has(k)) lines.set(k, { site_id: r.site_id, material_id: r.material_id, bought: 0, used: 0, paid: 0, priced: 0 });
    return lines.get(k)!;
  };
  for (const r of bought) {
    if (upTo && r.entry_date > upTo) continue;
    const l = line(r);
    l.bought += Number(r.quantity);
    if (r.amount_paise === null) continue;
    l.paid += Number(r.amount_paise);
    l.priced += Number(r.quantity);
  }
  for (const r of used) {
    if (upTo && r.use_date > upTo) continue;
    line(r).used += Number(r.quantity);
  }
  return [...lines.values()].map((l) => ({
    site_id: l.site_id,
    material_id: l.material_id,
    bought: round3(l.bought),
    used: round3(l.used),
    left: round3(l.bought - l.used),
    rate: l.priced > 0 ? l.paid / l.priced : null,
  }));
}

/** Rupee value of a quantity at a rate, in whole paise. */
export const valueOf = (quantity: number, rate: number | null): number => (rate === null ? 0 : Math.round(quantity * rate));

/** A day's used lines grouped under their combination work, in the order first used; lines of no work (name '') last. */
export function byWork<T extends { mix_name: string }>(rows: T[]): { name: string; rows: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(r.mix_name, [...(groups.get(r.mix_name) ?? []), r]);
  return [...groups].map(([name, rows]) => ({ name, rows })).sort((a, b) => Number(!a.name) - Number(!b.name));
}

/** What a used line says about itself in a list: its combination work and its remark. */
export const usedNote = (r: { mix_name: string; remark: string }) => [r.mix_name, r.remark].filter(Boolean).join(' · ');

export const QTY = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

export interface RegisterLine {
  site_id: string;
  material_id: string;
  /** What was at the site before `from`. */
  opening: number;
  arrived: number;
  used: number;
  /** Opening + arrived − used; below zero when more was reported used than arrived. */
  closing: number;
  /** Average rate of what arrived with a rate, up to `to`; null when none had one. */
  rate: number | null;
}

/**
 * A stock register for a period, per site and material: opening, arrived and used between `from` and `to` (both days
 * included), and closing. Materials that never moved by `to` are left out.
 */
export function stockRegister(bought: Bought[], used: Used[], from: string, to: string): RegisterLine[] {
  const dayBefore = (d: string) => d < from;
  const before = new Map(stockLines(bought.filter((b) => dayBefore(b.entry_date)), used.filter((u) => dayBefore(u.use_date)))
    .map((l) => [`${l.site_id}|${l.material_id}`, l]));
  return stockLines(bought, used, to).map((l) => {
    const open = before.get(`${l.site_id}|${l.material_id}`);
    const opening = open ? open.left : 0;
    return {
      site_id: l.site_id,
      material_id: l.material_id,
      opening,
      arrived: round3(l.bought - (open?.bought ?? 0)),
      used: round3(l.used - (open?.used ?? 0)),
      closing: l.left,
      rate: l.rate,
    };
  });
}

/** One line of a material's passbook at a site: an arrival (in) or a use on a daily report (out). */
export interface PassbookLine<T> { date: string; in: number; out: number; balance: number; row: T }

/**
 * A material's movement at one site, like a bank passbook: the balance before `from`, then each arrival and use in the
 * period with the running balance. On the same day arrivals come before uses.
 */
export function passbook<B extends Bought, U extends Used>(bought: B[], used: U[], from: string, to: string):
  { opening: number; lines: PassbookLine<B | U>[] } {
  let balance = round3(bought.filter((b) => b.entry_date < from).reduce((s, b) => s + Number(b.quantity), 0)
    - used.filter((u) => u.use_date < from).reduce((s, u) => s + Number(u.quantity), 0));
  const opening = balance;
  const events = [
    ...bought.filter((b) => b.entry_date >= from && b.entry_date <= to).map((b) => ({ date: b.entry_date, qty: Number(b.quantity), row: b as B | U })),
    ...used.filter((u) => u.use_date >= from && u.use_date <= to).map((u) => ({ date: u.use_date, qty: -Number(u.quantity), row: u as B | U })),
  ].sort((a, b) => a.date.localeCompare(b.date) || b.qty - a.qty);
  const lines = events.map((e) => {
    balance = round3(balance + e.qty);
    return { date: e.date, in: Math.max(e.qty, 0), out: Math.max(-e.qty, 0), balance, row: e.row };
  });
  return { opening, lines };
}
