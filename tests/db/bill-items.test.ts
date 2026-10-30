import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { billTotals, priceItem } from '@/lib/ledger/bill-items';
import { reverseEntry } from '@/lib/ledger/lifecycle';
import { clientBill } from '@/lib/ledger/posting/client';
import { vendorBill } from '@/lib/ledger/posting/vendor';
import { postEntry } from '@/lib/ledger/repo';
import { createMigratedDb, OWNER, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let cement: string;
let sand: string;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  const material = async (name: string) =>
    (await db.query<{ id: string }>(`insert into materials (name) values ($1) returning id`, [name])).rows[0]!.id;
  cement = await material('Cement');
  sand = await material('Sand');
});

const items = () => [
  priceItem({ materialId: cement, quantityMilli: 100_000, ratePaise: 35_000, gstBp: 2_800 }),
  priceItem({ materialId: sand, quantityMilli: 2_500, ratePaise: 120_000, gstBp: 500 }),
];

const billWith = (billItems: ReturnType<typeof items>, gstPaise = billTotals(billItems).gst) => vendorBill({
  firmId: seed.jayraj, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-10-29', billNo: 'T-1',
  items: [{ costHead: 'material', amountPaise: billTotals(billItems).base }], gstPaise, billItems,
});

it('starts with the usual GST rates', async () => {
  const { rows } = await db.query<{ rate_bp: number }>('select rate_bp from gst_rates order by rate_bp');
  expect(rows.map((r) => r.rate_bp)).toEqual([0, 500, 1200, 1800, 2800]);
});

it('keeps a vendor bill’s items, its GST to claim, and the item names on the party page', async () => {
  const saved = await postEntry(db, billWith(items()), OWNER);

  const stored = await db.query('select line_no, quantity::text, rate_paise, gst_bp, amount_paise, gst_paise from bill_items where entry_id = $1 order by line_no', [saved.id]);
  expect(stored.rows).toEqual([
    { line_no: 1, quantity: '100.000', rate_paise: 35_000, gst_bp: 2_800, amount_paise: 3_500_000, gst_paise: 980_000 },
    { line_no: 2, quantity: '2.500', rate_paise: 120_000, gst_bp: 500, amount_paise: 300_000, gst_paise: 15_000 },
  ]);
  const balances = await db.query(`select account, amount_paise from balances where account in ('site_cost', 'gst_input', 'vendor_payable') order by account`);
  expect(balances.rows).toEqual([
    { account: 'vendor_payable', amount_paise: -4_795_000 },
    { account: 'site_cost', amount_paise: 3_800_000 },
    { account: 'gst_input', amount_paise: 995_000 },
  ]);
  const party = await db.query('select amount_paise, item_names from party_rows');
  expect(party.rows).toEqual([{ amount_paise: 4_795_000, item_names: 'Cement, Sand' }]);

  // Cancelling posts the opposite lines; the items stay with the original, which drops off the party page.
  await reverseEntry(db, saved.id, OWNER, 'wrong vendor');
  expect((await db.query('select * from party_rows')).rows).toEqual([]);
});

it('refuses items that do not add up to the entry, or whose amount is not quantity × rate', async () => {
  await expect(postEntry(db, billWith(items(), 1), OWNER)).rejects.toThrow('do not match the entry');
  const [first] = items();
  const wrongAmount = { ...first!, amountPaise: first!.amountPaise + 1 };
  await expect(postEntry(db, billWith([wrongAmount], first!.gstPaise), OWNER)).rejects.toThrow('bill_items');
});

it('never changes stored items', async () => {
  const saved = await postEntry(db, billWith(items()), OWNER);
  await expect(db.query('update bill_items set rate_paise = 1 where entry_id = $1', [saved.id])).rejects.toThrow('append-only');
  await expect(db.query('delete from bill_items where entry_id = $1', [saved.id])).rejects.toThrow('append-only');
});

it('counts a client bill’s GST in what the client owes, but not in the site’s income', async () => {
  const billItems = [priceItem({ materialId: cement, quantityMilli: 1_000, ratePaise: 100_000_00, gstBp: 1_800 })];
  await postEntry(db, clientBill({
    client: seed.client, billDate: '2026-10-29', billNo: 'RA-9', grossPaise: 100_000_00, gstPaise: 18_000_00, billItems,
    deductions: { tdsPaise: 1_000_00 },
  }), OWNER);
  const { rows } = await db.query('select gross_paise, gst_paise, tds_paise, receivable_paise from client_rows');
  expect(rows).toEqual([{ gross_paise: 118_000_00, gst_paise: 18_000_00, tds_paise: 1_000_00, receivable_paise: 117_000_00 }]);
  const income = await db.query(`select amount_paise from balances where account = 'contract_income'`);
  expect(income.rows).toEqual([{ amount_paise: -100_000_00 }]);
});
