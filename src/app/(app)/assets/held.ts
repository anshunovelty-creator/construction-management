/** An asset bought at a site (one bill line). */
export interface Bought { material_id: string; site_id: string | null; quantity: number | string }
/** An asset taken from one site to another. */
export interface Move { material_id: string; from_site_id: string; to_site_id: string; quantity: number | string }

export interface Holding { material_id: string; site_id: string; bought: number; movedIn: number; movedOut: number; now: number }

/** What is at each site, per asset: bought there + moved in − moved out. */
export function holdings(bought: Bought[], moves: Move[]): Holding[] {
  const map = new Map<string, Holding>();
  const at = (material_id: string, site_id: string) => {
    const key = `${material_id}|${site_id}`;
    if (!map.has(key)) map.set(key, { material_id, site_id, bought: 0, movedIn: 0, movedOut: 0, now: 0 });
    return map.get(key)!;
  };
  for (const b of bought) if (b.site_id) at(b.material_id, b.site_id).bought += Number(b.quantity);
  for (const m of moves) {
    at(m.material_id, m.from_site_id).movedOut += Number(m.quantity);
    at(m.material_id, m.to_site_id).movedIn += Number(m.quantity);
  }
  for (const h of map.values()) h.now = h.bought + h.movedIn - h.movedOut;
  return [...map.values()];
}

/** How many of an asset are at a site now. */
export const heldAt = (bought: Bought[], moves: Move[], material: string, site: string) =>
  holdings(bought, moves).find((h) => h.material_id === material && h.site_id === site)?.now ?? 0;
