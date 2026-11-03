import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { asUser, createMigratedDb, createUser, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let cement: string;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  cement = (await db.query<{ id: string }>(
    `insert into materials (name, unit_id) select 'Cement', id from units where name = 'Bags' returning id`)).rows[0]!.id;
});

/** A supervisor's line: this much arrived at a site, at this rate per unit (null when not known). */
const arrive = (user: string, siteId: string, quantity: string, rate: number | null, materialId = cement) =>
  asUser(db, user, (tx) => tx.query(
    `insert into stock_in (site_id, in_date, material_id, quantity, rate_paise) values ($1, '2026-10-30', $2, $3, $4)`,
    [siteId, materialId, quantity, rate]));

it('puts what a supervisor says arrived into their own site’s stock only; assets go to the assets list', async () => {
  const other = (await db.query<{ id: string }>(`insert into sites (name) values ('Other Site') returning id`)).rows[0]!.id;
  const axe = (await db.query<{ id: string }>(`insert into materials (name, item_kind) values ('Axe', 'asset') returning id`)).rows[0]!.id;
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  await arrive(ramesh, seed.svgSite, '100', 35_000);
  await arrive(ramesh, seed.svgSite, '50.5', null);
  await arrive(ramesh, seed.svgSite, '3', 50_000, axe);
  await expect(arrive(ramesh, other, '1', null)).rejects.toThrow('row-level security');

  const stock = await asUser(db, ramesh, (tx) => tx.query(
    `select material_id, quantity::text, amount_paise from stock_in_rows order by amount_paise nulls last`));
  expect(stock.rows).toEqual([
    { material_id: cement, quantity: '100.000', amount_paise: 3_500_000 },
    { material_id: cement, quantity: '50.500', amount_paise: null },
  ]);
  expect((await db.query(`select material_id, quantity::text from asset_in_rows`)).rows).toEqual([{ material_id: axe, quantity: '3.000' }]);
});

it('lets a supervisor report material used at their own site only, and lets use go past the stock', async () => {
  const other = (await db.query<{ id: string }>(`insert into sites (name) values ('Other Site') returning id`)).rows[0]!.id;
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const use = (siteId: string, quantity: string) => asUser(db, ramesh, (tx) => tx.query(
    `insert into material_use (site_id, use_date, material_id, quantity) values ($1, '2026-10-30', $2, $3)`, [siteId, cement, quantity]));

  await use(seed.svgSite, '0.45');
  await use(seed.svgSite, '999'); // more than was bought: saved, and the stock page shows it in red
  await expect(use(other, '1')).rejects.toThrow('row-level security');
  const { rows } = await db.query<{ used: string }>(`select sum(quantity)::text as used from material_use where site_id = $1`, [seed.svgSite]);
  expect(rows).toEqual([{ used: '999.450' }]);
});

it('keeps a material’s unit from Setup', async () => {
  const { rows } = await db.query(`select u.name from units u join materials m on m.unit_id = u.id where m.id = $1`, [cement]);
  expect(rows).toEqual([{ name: 'Bags' }]);
});

it('lets a supervisor see the stock of their own sites only', async () => {
  await arrive(await createUser(db, 'office', 'Office'), seed.svgSite, '100', 35_000);
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const suresh = await createUser(db, 'supervisor', 'Suresh', { sites: [] });
  const seen = (user: string) => asUser(db, user, (tx) => tx.query(`select quantity::text from stock_in_rows`));
  expect((await seen(ramesh)).rows).toEqual([{ quantity: '100.000' }]);
  expect((await seen(suresh)).rows).toEqual([]);
});

it('keeps work done with its measurement, and refuses an amount that is not quantity × rate', async () => {
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const m2 = (await db.query<{ id: string }>(`select id from units where name = 'M2'`)).rows[0]!.id;
  const add = (amount: number) => asUser(db, ramesh, (tx) => tx.query(
    `insert into work_done (site_id, work_date, activity, measurement, quantity, unit_id, rate_paise, amount_paise)
     values ($1, '2026-10-18', 'Plaster', '4.3*1.3', 5.59, $2, 60000, $3)`, [seed.svgSite, m2, amount]));
  await add(335_400);
  await expect(add(1)).rejects.toThrow('work_done');
  // Where on the site is optional, but never blank.
  const at = (location: string | null) => asUser(db, ramesh, (tx) => tx.query(
    `insert into work_done (site_id, work_date, activity, location, measurement, quantity, unit_id, rate_paise, amount_paise)
     values ($1, '2026-10-18', 'Plaster', $3, '4.3*1.3', 5.59, $2, 60000, 335400)`, [seed.svgSite, m2, location]));
  await at('Washroom');
  await at(null);
  await expect(at('  ')).rejects.toThrow('work_done');
});

it('lets a supervisor keep materials, units and workers in Setup, but not vendors', async () => {
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const as = (sql: string, params: unknown[] = []) => asUser(db, ramesh, (tx) => tx.query(sql, params));
  await as(`insert into materials (name) values ('Tiles')`);
  expect((await as(`update materials set name = 'Cement OPC' where id = $1`, [cement])).affectedRows).toBe(1);
  await as(`insert into units (name) values ('Trip')`);
  await as(`insert into parties (kind, name, rate_paise) values ('worker', 'Raju', 70000)`);
  expect((await as(`update parties set name = 'Raju K' where name = 'Raju'`)).affectedRows).toBe(1);
  await expect(as(`insert into parties (kind, name) values ('vendor', 'Some Shop')`)).rejects.toThrow('row-level security');
  expect((await as(`update parties set name = 'X' where id = $1`, [seed.ansari])).affectedRows).toBe(0);
});
