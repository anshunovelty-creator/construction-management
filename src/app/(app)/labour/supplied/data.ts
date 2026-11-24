import { type ChargeRate, type PlaceDays, type SupplyWorker } from '@/lib/labour-supply';
import type { LabourMonth, LabourRate } from '@/lib/labour';
import type { createClient } from '@/lib/supabase/server';
import { allRows, type LabourWorker } from '../data';

type Db = Awaited<ReturnType<typeof createClient>>;

export interface Place { id: string; name: string; firm_id: string | null; site_id: string | null; client_id: string | null; is_active: boolean }
export type MonthWorker = SupplyWorker & { name: string; skill: string };

const group = <T extends { worker_id: string }>(rows: T[]) => {
  const map = new Map<string, T[]>();
  for (const r of rows) map.set(r.worker_id, [...(map.get(r.worker_id) ?? []), r]);
  return map;
};

/** Everyone with days or OT in a month ("2026-11"), where they were, and what a day is paid and charged at. A Labour login reads no charged rates. */
export async function loadSupplied(db: Db, month: string): Promise<{ workers: MonthWorker[]; places: Place[] }> {
  const first: [string, string] = ['month', `${month}-01`];
  const [people, rates, months, places, said, charges] = await Promise.all([
    allRows<LabourWorker & { place_id: string | null }>(db, 'labour_workers', ['name', 'id']),
    allRows<LabourRate & { worker_id: string }>(db, 'labour_rates', ['worker_id', 'from_month']),
    allRows<LabourMonth & { worker_id: string }>(db, 'labour_months', ['worker_id'], first),
    allRows<Place>(db, 'labour_places', ['name']),
    allRows<PlaceDays & { worker_id: string }>(db, 'labour_month_places', ['worker_id', 'place_id'], first),
    allRows<ChargeRate & { worker_id: string }>(db, 'labour_charge_rates', ['worker_id', 'from_month']),
  ]);
  const [ratesOf, saidOf, chargesOf] = [group(rates), group(said), group(charges)];
  const monthOf = new Map(months.map((m) => [m.worker_id, m]));
  const workers = people.flatMap((p) => {
    const m = monthOf.get(p.id);
    const [days, ot] = [Number(m?.present_days ?? 0), Number(m?.ot_hours ?? 0)];
    if (days === 0 && ot === 0) return [];
    return [{ id: p.id, name: p.name, skill: p.skill, days, ot, rates: ratesOf.get(p.id) ?? [], charges: chargesOf.get(p.id) ?? [], usual: p.place_id, said: saidOf.get(p.id) ?? [] }];
  });
  return { workers, places };
}

export interface Confirmed { entryId: string; serial: string; base: number; gst: number; tds: number }

/** The labour supplied already in the books for a month, by `firm/site`. */
export async function loadConfirmed(db: Db, month: string): Promise<Map<string, Confirmed>> {
  const { data } = await db.from('entries')
    .select('id, serial, lines:entry_lines(account, amount_paise, firm_id, site_id)')
    .eq('entry_type', 'labour_supplied').eq('reference', month)
    .returns<{ id: string; serial: string; lines: { account: string; amount_paise: number; firm_id: string; site_id: string | null }[] }[]>();
  if (!data?.length) return new Map();
  const { data: statuses } = await db.from('entry_status').select('entry_id, status').in('entry_id', data.map((e) => e.id));
  const live = new Set((statuses ?? []).filter((s) => s.status === 'verified' || s.status === 'unverified').map((s) => s.entry_id as string));
  return new Map(data.filter((e) => live.has(e.id)).flatMap((e) => {
    const cost = e.lines.find((l) => l.account === 'site_cost');
    const of = (account: string) => Math.abs(Number(e.lines.find((l) => l.account === account)?.amount_paise ?? 0));
    return cost ? [[`${cost.firm_id}/${cost.site_id}`, { entryId: e.id, serial: e.serial, base: Number(cost.amount_paise), gst: of('gst_input'), tds: of('tds_payable') }] as const] : [];
  }));
}
