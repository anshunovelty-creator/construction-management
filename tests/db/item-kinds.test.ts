import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { billTotals, priceItem, type ItemKind } from '@/lib/ledger/bill-items';
import { vendorBill } from '@/lib/ledger/posting/vendor';
import { postEntry } from '@/lib/ledger/repo';
import { asUser, createMigratedDb, createUser, OWNER, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let cement: string, axe: string, plate: string;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  const material = async (name: string, kind: ItemKind) => (await db.query<{ id: string }>(
    `insert into materials (name, item_kind) values ($1, $2) returning id`, [name, kind])).rows[0]!.id;
  cement = await material('Cement', 'consumable');
  axe = await material('Axe', 'asset');
  plate = await material('Shuttering plate', 'rented');
});

/** A party's bill of these lines, posted the way the Add bill form does: assets apart from the site's cost. */
const bill = (billNo: string, lines: { materialId: string; kind: ItemKind; ratePaise: number }[], assetsOverride?: number) => {
  const billItems = lines.map((l) => ({ ...priceItem({ materialId: l.materialId, quantityMilli: 10_000, ratePaise: l.ratePaise, gstBp: 1_800 }), kind: l.kind }));
  const cost = billTotals(billItems.filter((i) => i.kind !== 'asset')).base;
  const assets = assetsOverride ?? billTotals(billItems.filter((i) => i.kind === 'asset')).base;
  return vendorBill({
    firmId: seed.jayraj, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-11-02', billNo,
    items: cost > 0 ? [{ costHead: 'material', amountPaise: cost }] : [], assetsPaise: assets,
    gstPaise: billTotals(billItems).gst, billItems,
  });
};

it('keeps assets out of the site’s cost and out of stock, and rented things out of stock', async () => {
  await postEntry(db, bill('B-1', [
    { materialId: cement, kind: 'consumable', ratePaise: 35_000 }, // 10 × ₹350
    { materialId: axe, kind: 'asset', ratePaise: 50_000 }, // 10 × ₹500
    { materialId: plate, kind: 'rented', ratePaise: 1_000 }, // 10 × ₹10
  ]), OWNER);

  const lines = await db.query(`select account::text, amount_paise::text, site_id from entry_lines
    where account in ('site_cost', 'company_assets') order by account::text`);
  expect(lines.rows).toEqual([
    { account: 'company_assets', amount_paise: '500000', site_id: seed.svgSite }, // the axes
    { account: 'site_cost', amount_paise: '360000', site_id: seed.svgSite }, // cement + rented plates
  ]);
  expect((await db.query(`select material_id from stock_in_rows`)).rows).toEqual([{ material_id: cement }]);
  expect((await db.query(`select material_id, site_id, quantity::text from asset_in_rows`)).rows)
    .toEqual([{ material_id: axe, site_id: seed.svgSite, quantity: '10.000' }]);
});

it('shows the site of a bill of assets only, and refuses assets that do not match the bill', async () => {
  await postEntry(db, bill('B-2', [{ materialId: axe, kind: 'asset', ratePaise: 50_000 }]), OWNER);
  expect((await db.query(`select site_id from party_rows where reference = 'B-2'`)).rows).toEqual([{ site_id: seed.svgSite }]);

  // An asset line posted as the site's cost does not add up.
  await expect(postEntry(db, bill('B-3', [
    { materialId: axe, kind: 'asset', ratePaise: 50_000 }, { materialId: cement, kind: 'consumable', ratePaise: 1_000 },
  ], 0), OWNER)).rejects.toThrow();
});

it('lets the owner and office move assets between sites, not supervisors', async () => {
  const other = (await db.query<{ id: string }>(`insert into sites (name) values ('Other Site') returning id`)).rows[0]!.id;
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite, other] });
  const move = (user: string) => asUser(db, user, (tx) => tx.query(
    `insert into asset_moves (material_id, quantity, from_site_id, to_site_id, move_date) values ($1, 4, $2, $3, '2026-11-02')`,
    [axe, seed.svgSite, other]));
  await expect(move(ramesh)).rejects.toThrow('row-level security');
  await move(await createUser(db, 'office', 'Office'));
  expect((await db.query(`select quantity::text from asset_moves`)).rows).toEqual([{ quantity: '4.000' }]);
});
