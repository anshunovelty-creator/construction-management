import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { billTotals, priceItem } from '@/lib/ledger/bill-items';
import { reverseEntry } from '@/lib/ledger/lifecycle';
import { vendorBill } from '@/lib/ledger/posting/vendor';
import { postEntry } from '@/lib/ledger/repo';
import { asUser, createMigratedDb, createUser, OWNER, seedBasics, type Seed } from './harness';

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

const bill = (billNo: string, quantityMilli: number) => {
  const billItems = [priceItem({ materialId: cement, quantityMilli, ratePaise: 35_000, gstBp: 2_800 })];
  const { base, gst } = billTotals(billItems);
  return vendorBill({
    firmId: seed.jayraj, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-10-30', billNo,
    items: [{ costHead: 'material', amountPaise: base }], gstPaise: gst, billItems,
  });
};

it('puts what a party’s bill was for into stock at the bill’s site, and takes it out when the bill is cancelled', async () => {
  const first = await postEntry(db, bill('S-1', 100_000), OWNER);
  await postEntry(db, bill('S-2', 50_500), OWNER);

  const stock = () => db.query(
    `select site_id, material_id, sum(quantity)::text as quantity from stock_in_rows where firm_id = $1 group by 1, 2`, [seed.jayraj]);
  expect((await stock()).rows).toEqual([{ site_id: seed.svgSite, material_id: cement, quantity: '150.500' }]);

  await reverseEntry(db, first.id, OWNER, 'wrong party');
  expect((await stock()).rows).toEqual([{ site_id: seed.svgSite, material_id: cement, quantity: '50.500' }]);
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

it('lets a supervisor see what was bought for their own site, for the material rates, and nothing for other sites', async () => {
  await postEntry(db, bill('S-1', 100_000), OWNER);
  const other = (await db.query<{ id: string }>(`insert into sites (name) values ('Other Site') returning id`)).rows[0]!.id;
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const bought = (siteId: string) => asUser(db, ramesh, (tx) => tx.query(
    `select material_id, quantity::text, amount_paise from app_site_bought($1, '2026-10-30')`, [siteId]));
  expect((await bought(seed.svgSite)).rows).toEqual([{ material_id: cement, quantity: '100.000', amount_paise: 3_500_000 }]);
  expect((await bought(other)).rows).toEqual([]);
});

it('keeps work done with its measurement, and refuses an amount that is not quantity × rate', async () => {
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const m2 = (await db.query<{ id: string }>(`select id from units where name = 'M2'`)).rows[0]!.id;
  const add = (amount: number) => asUser(db, ramesh, (tx) => tx.query(
    `insert into work_done (site_id, work_date, activity, measurement, quantity, unit_id, rate_paise, amount_paise)
     values ($1, '2026-10-18', 'Plaster', '4.3*1.3', 5.59, $2, 60000, $3)`, [seed.svgSite, m2, amount]));
  await add(335_400);
  await expect(add(1)).rejects.toThrow('work_done');
});
