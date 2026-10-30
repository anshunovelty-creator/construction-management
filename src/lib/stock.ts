/** A material bought on a party's bill (from stock_in_rows), or used on a daily report (from material_use). */
export interface Bought { site_id: string; material_id: string; entry_date: string; quantity: number | string; amount_paise: number | string }
export interface Used { site_id: string; material_id: string; use_date: string; quantity: number | string }

export interface StockLine {
  site_id: string;
  material_id: string;
  bought: number;
  used: number;
  /** Bought less used; below zero when more was reported used than bought (a bill not entered yet). */
  left: number;
  /** Average purchase rate before GST, in paise per unit; null when nothing was bought. */
  rate: number | null;
}

// Quantities are kept to 3 decimals; rounding stops 0.1 + 0.2 showing as 0.30000000000000004.
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Stock per site and material, whichever firm bought it. Only what happened up to `upTo` (a report's day) when given. */
export function stockLines(bought: Bought[], used: Used[], upTo?: string): StockLine[] {
  const lines = new Map<string, { site_id: string; material_id: string; bought: number; used: number; paid: number }>();
  const line = (r: { site_id: string; material_id: string }) => {
    const k = `${r.site_id}|${r.material_id}`;
    if (!lines.has(k)) lines.set(k, { site_id: r.site_id, material_id: r.material_id, bought: 0, used: 0, paid: 0 });
    return lines.get(k)!;
  };
  for (const r of bought) {
    if (upTo && r.entry_date > upTo) continue;
    const l = line(r);
    l.bought += Number(r.quantity);
    l.paid += Number(r.amount_paise);
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
    rate: l.bought > 0 ? l.paid / l.bought : null,
  }));
}

/** Rupee value of a quantity at a rate, in whole paise. */
export const valueOf = (quantity: number, rate: number | null): number => (rate === null ? 0 : Math.round(quantity * rate));

export const QTY = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
