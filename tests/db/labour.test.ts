import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { asUser, createMigratedDb, createUser, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let margub: string;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  margub = (await db.query<{ id: string }>(
    `insert into parties (kind, name, rate_paise, site_id) values ('worker', 'Margub', 10000, $1) returning id`,
    [seed.svgSite])).rows[0]!.id;
});

it('lets a supervisor mark P or A with OT at their own site, once a day, paying the day and OT at day ÷ 8', async () => {
  const other = (await db.query<{ id: string }>(`insert into sites (name) values ('Other Site') returning id`)).rows[0]!.id;
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite, other] });
  // Margub: ₹100 an hour, so a day is ₹800 and an OT hour ₹100.
  const mark = (siteId: string, partyId: string, present: boolean, ot: string, amount: number) => asUser(db, ramesh, (tx) => tx.query(
    `insert into labour_day (site_id, work_date, party_id, present, ot_hours, day_pay_paise, amount_paise)
     values ($1, '2026-10-18', $2, $3, $4, 80000, $5)`, [siteId, partyId, present, ot, amount]));

  await mark(seed.svgSite, margub, true, '2.5', 105_000);
  await expect(mark(seed.svgSite, margub, false, '0', 0)).rejects.toThrow('duplicate');
  await expect(mark(other, margub, true, '0', 80_000)).rejects.toThrow('duplicate'); // paid once a day
  await mark(other, margub, false, '0', 0); // absent there is fine
  await expect(mark(seed.svgSite, seed.ansari, true, '0', 80_000)).rejects.toThrow('not a worker or staff');

  const roshani = (await db.query<{ id: string }>(`insert into parties (kind, name) values ('worker', 'Roshani') returning id`)).rows[0]!.id;
  await expect(mark(seed.svgSite, roshani, false, '2', 20_000)).rejects.toThrow('check constraint'); // no OT when absent
  await expect(mark(seed.svgSite, roshani, true, '0', 70_000)).rejects.toThrow('check constraint'); // not the day's pay
});

it('keeps other site costs, but not material, which comes from stock', async () => {
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const add = (head: string) => asUser(db, ramesh, (tx) => tx.query(
    `insert into other_cost (site_id, work_date, description, cost_head, quantity, rate_paise, amount_paise)
     values ($1, '2026-10-18', 'Tractor', $2, 1, 200000, 200000)`, [seed.svgSite, head]));
  await add('machine_hire');
  await expect(add('material')).rejects.toThrow('check constraint');
});
