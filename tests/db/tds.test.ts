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

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  cement = (await db.query<{ id: string }>(`insert into materials (name) values ('Cement') returning id`)).rows[0]!.id;
});

const items = () => [
  priceItem({ materialId: cement, quantityMilli: 100_000, ratePaise: 35_000, gstBp: 2_800 }),
  priceItem({ materialId: cement, quantityMilli: 10_000, ratePaise: 120_000, gstBp: 500 }),
];

const vendorBillWithTds = (rateBp: number, section: string, billNo = 'T-5') => {
  const billItems = items();
  const { base, gst } = billTotals(billItems);
  return vendorBill({
    firmId: seed.jayraj, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-10-29', billNo,
    items: [{ costHead: 'material', amountPaise: base }], gstPaise: gst, billItems, tds: { rateBp, section },
  });
};

it('starts with the usual TDS rates', async () => {
  const { rows } = await db.query<{ rate_bp: number; section: string }>('select rate_bp, section from tds_rates order by rate_bp');
  expect(rows.map((r) => r.rate_bp)).toEqual([0, 100, 200, 1000]);
});

it('takes a vendor bill’s TDS from what we pay the vendor, and keeps it for the TDS record', async () => {
  const saved = await postEntry(db, vendorBillWithTds(100, '194C, individual or HUF'), OWNER);

  // 1% of the amount before GST (₹47,00,000) is ₹47,000: owed to the government, not paid to the vendor.
  const balances = await db.query(`select account, amount_paise from balances where account in ('tds_payable', 'vendor_payable') order by account`);
  expect(balances.rows).toEqual([
    { account: 'vendor_payable', amount_paise: -5_693_000 },
    { account: 'tds_payable', amount_paise: -47_000 },
  ]);
  const record = await db.query('select rate_bp, section, base_paise, tds_paise from bill_tds where entry_id = $1', [saved.id]);
  expect(record.rows).toEqual([{ rate_bp: 100, section: '194C, individual or HUF', base_paise: 4_700_000, tds_paise: 47_000 }]);
  const register = await db.query('select serial, section, base_paise, tds_paise from tds_rows');
  expect(register.rows).toEqual([{ serial: saved.serial, section: '194C, individual or HUF', base_paise: 4_700_000, tds_paise: 47_000 }]);
  const party = await db.query('select amount_paise from party_rows');
  expect(party.rows).toEqual([{ amount_paise: 5_693_000 }]);
});

it('refuses a TDS that does not match the entry, and posts the same bill when there is no TDS record', async () => {
  const draft = vendorBillWithTds(100, '194C');
  draft.tds = { ...draft.tds!, tdsPaise: 46_000 };
  await expect(postEntry(db, draft, OWNER)).rejects.toThrow('does not match the entry');
  await expect(postEntry(db, { ...vendorBillWithTds(100, '194C', 'T-6'), tds: undefined }, OWNER)).resolves.toBeTruthy();
});

it('never changes a stored TDS record', async () => {
  const saved = await postEntry(db, vendorBillWithTds(100, '194C'), OWNER);
  await expect(db.query('update bill_tds set tds_paise = 1 where entry_id = $1', [saved.id])).rejects.toThrow('append-only');
  await expect(db.query('delete from bill_tds where entry_id = $1', [saved.id])).rejects.toThrow('append-only');
});

it('books a client bill’s TDS as claimable and lists it on the TDS record; a cancelled bill drops off', async () => {
  const billItems = [priceItem({ materialId: cement, quantityMilli: 1_000, ratePaise: 100_000_00, gstBp: 1_800 })];
  const saved = await postEntry(db, clientBill({
    client: seed.client, billDate: '2026-10-29', billNo: 'RA-9', grossPaise: 100_000_00, gstPaise: 18_000_00, billItems,
    deductions: { tdsPaise: 1_000_00 }, tds: { rateBp: 100, section: '194C, company' },
  }), OWNER);
  const register = await db.query('select entry_type, tds_paise from tds_rows');
  expect(register.rows).toEqual([{ entry_type: 'client_bill', tds_paise: 1_000_00 }]);
  const claim = await db.query(`select amount_paise from balances where account = 'tds_claimable'`);
  expect(claim.rows).toEqual([{ amount_paise: 1_000_00 }]);

  await reverseEntry(db, saved.id, OWNER, 'wrong bill');
  expect((await db.query('select * from tds_rows')).rows).toEqual([]);
});
