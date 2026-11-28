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

  // Half day: half the day's pay, OT still a day ÷ 8; only when present, and only for workers.
  const half = (partyId: string, present: boolean, ot: string, amount: number) => asUser(db, ramesh, (tx) => tx.query(
    `insert into labour_day (site_id, work_date, party_id, present, half_day, ot_hours, day_pay_paise, amount_paise)
     values ($1, '2026-10-19', $2, $3, true, $4, 80001, $5)`, [seed.svgSite, partyId, present, ot, amount]));
  await expect(half(roshani, true, '0', 80_001)).rejects.toThrow('check constraint'); // a full day's pay
  await expect(half(roshani, false, '0', 0)).rejects.toThrow('check constraint'); // a half day is present
  await half(roshani, true, '1', 50_001); // 40,000.5 rounds to 40,001, + 10,000

  // Staff have a fixed salary: marked present or absent, never OT.
  const sunil = (await db.query<{ id: string }>(`insert into parties (kind, name) values ('staff', 'Sunil') returning id`)).rows[0]!.id;
  await expect(mark(seed.svgSite, sunil, true, '1', 90_000)).rejects.toThrow('no OT');
  await mark(seed.svgSite, sunil, true, '0', 80_000);
  await expect(half(sunil, true, '0', 40_001)).rejects.toThrow('no half day');
});

it('keeps other site costs, but not material, which comes from stock', async () => {
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const add = (head: string) => asUser(db, ramesh, (tx) => tx.query(
    `insert into other_cost (site_id, work_date, description, cost_head, quantity, rate_paise, amount_paise)
     values ($1, '2026-10-18', 'Tractor', $2, 1, 200000, 200000)`, [seed.svgSite, head]));
  await add('machine_hire');
  await expect(add('material')).rejects.toThrow('check constraint');
});

it('keeps what staff are paid from a supervisor, who still marks them', async () => {
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const office = await createUser(db, 'office', 'Priya', { firms: [seed.jayraj] });
  const sunil = (await db.query<{ id: string }>(`insert into parties (kind, name, rate_paise) values ('staff', 'Sunil', 3100000) returning id`)).rows[0]!.id;
  await asUser(db, ramesh, async (tx) => {
    expect((await tx.query(`select id from parties where kind = 'staff'`)).rows).toEqual([]);
    expect((await tx.query(`select * from app_site_staff()`)).rows).toEqual([{ id: sunil, name: 'Sunil', site_id: null, has_rate: true }]);
    // Whatever amount is sent, the database works out the day: 31,000 ÷ 31 days.
    await tx.query(`insert into labour_day (site_id, work_date, party_id, present, day_pay_paise, amount_paise) values ($1, '2026-10-18', $2, true, 7, 7)`, [seed.svgSite, sunil]);
    expect((await tx.query(`select day_pay_paise::int, amount_paise::int from labour_day`)).rows).toEqual([{ day_pay_paise: 0, amount_paise: 0 }]);
    expect((await tx.query(`select * from labour_day_staff`)).rows).toEqual([]);
    expect((await tx.query(`update parties set rate_paise = 1 where id = $1 returning id`, [sunil])).rows).toEqual([]);
  });
  await expect(asUser(db, ramesh, (tx) => tx.query(`insert into parties (kind, name) values ('staff', 'Extra')`))).rejects.toThrow('row-level security');
  await asUser(db, office, async (tx) => {
    expect((await tx.query(`select day_pay_paise::int, amount_paise::int from labour_day_staff`)).rows).toEqual([{ day_pay_paise: 100000, amount_paise: 100000 }]);
  });
  // Taken off by the supervisor the same day, its pay goes with it.
  await asUser(db, ramesh, (tx) => tx.query(`delete from labour_day where party_id = $1`, [sunil]));
  expect((await db.query(`select * from labour_day_staff`)).rows).toEqual([]);
});

it('marks a cost as on a bill, by the office only and not once it is paid', async () => {
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const office = await createUser(db, 'office', 'Priya', { firms: [seed.jayraj] });
  const cost = (await asUser(db, ramesh, (tx) => tx.query<{ id: string }>(
    `insert into other_cost (site_id, work_date, description, cost_head, quantity, rate_paise, amount_paise)
     values ($1, '2026-10-18', 'Tractor', 'transport', 1, 200000, 200000) returning id`, [seed.svgSite]))).rows[0]!.id;
  const mark = (user: string) => asUser(db, user, (tx) => tx.query(`select app_mark_on_bill('cost', $1, true)`, [cost]));
  await expect(mark(ramesh)).rejects.toThrow('cannot settle');
  await mark(office);
  expect((await db.query(`select on_bill from other_cost where id = $1`, [cost])).rows).toEqual([{ on_bill: true }]);
  await expect(asUser(db, office, (tx) => tx.query(`select app_mark_on_bill('cost', $1, true)`, [margub]))).rejects.toThrow('already paid or removed');
});

it('keeps one note per site and day, written over by anyone with the site, and no one else', async () => {
  const other = (await db.query<{ id: string }>(`insert into sites (name) values ('Other site') returning id`)).rows[0]!.id;
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const write = (user: string, siteId: string, note: string) => asUser(db, user, (tx) => tx.query(
    `insert into report_note (site_id, work_date, note) values ($1, '2026-10-18', $2)
     on conflict (site_id, work_date) do update set note = excluded.note`, [siteId, note]));
  await write(ramesh, seed.svgSite, 'Slab shuttering');
  await write(ramesh, seed.svgSite, 'Slab shuttering. Extra: drain cleared');
  expect((await db.query(`select note from report_note`)).rows).toEqual([{ note: 'Slab shuttering. Extra: drain cleared' }]);
  await expect(write(ramesh, other, 'Not mine')).rejects.toThrow('row-level security');
  await expect(write(ramesh, seed.svgSite, '  ')).rejects.toThrow('check constraint');
});
