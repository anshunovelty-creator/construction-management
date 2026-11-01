import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { reverseEntry } from '@/lib/ledger/lifecycle';
import { clientBill, clientReceipt } from '@/lib/ledger/posting/client';
import { openingVendorBalance } from '@/lib/ledger/posting/opening';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import { postEntry } from '@/lib/ledger/repo';
import { asUser, createMigratedDb, createUser, OWNER, seedBasics, type Seed } from './harness';

const SCRIPT = readFileSync(join(import.meta.dirname, '../../scripts/golive-reset.sql'), 'utf8');
/** The script with a list of test records filled in, as the owner would edit it on their phone. */
const withList = (kind: 'parties' | 'sites', names: string[]) => {
  const blank = `remove_${kind} text[] := array[]::text[];`;
  expect(SCRIPT).toContain(blank);
  return SCRIPT.replace(blank, `remove_${kind} text[] := array[${names.map((n) => `'${n}'`).join(', ')}]::text[];`);
};

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
});

const id = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
const names = async (table: string) =>
  (await db.query<{ name: string }>(`select name from ${table} order by name`)).rows.map((r) => r.name);
const count = async (table: string) => Number((await db.query<{ n: string }>(`select count(*)::text as n from ${table}`)).rows[0]!.n);

it('empties the books, the daily reports and the test setup records, keeping a backup and the real setup', async () => {
  const post = (draft: Parameters<typeof postEntry>[1]) => postEntry(db, draft, OWNER);
  // Test setup records: DEMO-named ones, and one the owner lists by name.
  const demoFirm = await id(`insert into firms (code, name) values ('DM', 'DEMO Firm') returning id`);
  await id(`insert into sites (name) values ('DEMO Site A') returning id`);
  await id(`insert into parties (kind, name) values ('vendor', 'DEMO Vendor') returning id`);
  const testVendor = await id(`insert into parties (kind, name) values ('vendor', 'Test Vendor') returning id`);
  await id(`insert into money_accounts (kind, name, firm_id) values ('bank', 'DEMO Bank', $1) returning id`, [demoFirm]);
  await createUser(db, 'office', 'DEMO Office', { firms: [demoFirm] });
  // Real people and things that must stay.
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const cement = await id(`insert into materials (name) values ('Cement') returning id`);

  await post(openingVendorBalance({ firmId: seed.jayraj, vendorId: seed.ansari, amountPaise: 1_000_00, asOf: '2026-10-21' }));
  await post(vendorBill({
    firmId: seed.jayraj, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-10-22', billNo: 'B-1',
    items: [{ costHead: 'material', amountPaise: 500_00 }], materialId: cement, gstPaise: 90_00,
    tds: { rateBp: 100, section: '194C' },
  }));
  await post(vendorBill({
    firmId: seed.jayraj, vendorId: testVendor, siteId: seed.svgSite, billDate: '2026-10-22', billNo: 'T-1',
    items: [{ costHead: 'material', amountPaise: 100_00 }],
  }));
  const paid = await post(vendorPayment({
    billFirmId: seed.jayraj, vendorId: seed.ansari, from: seed.jayrajBank, amountPaise: 300_00, paymentDate: '2026-10-23',
  }));
  await reverseEntry(db, paid.id, OWNER, 'typed twice');
  await post(clientBill({ client: seed.client, billDate: '2026-10-25', billNo: 'RA-1', grossPaise: 2_000_00, deductions: {} }));
  await post(clientReceipt({ client: seed.client, to: seed.jayrajBank, amountPaise: 1_000_00, receiptDate: '2026-10-26' }));
  await asUser(db, ramesh, (tx) => tx.query(
    `insert into material_use (site_id, use_date, material_id, quantity) values ($1, '2026-10-30', $2, 1)`, [seed.svgSite, cement]));
  const entriesBefore = await count('entries');
  expect(entriesBefore).toBeGreaterThan(5);

  await db.exec(withList('parties', ['Test Vendor']));

  for (const table of ['entries', 'entry_lines', 'entry_events', 'bill_items', 'bill_tds', 'serial_counters', 'material_use']) {
    expect([table, await count(table)]).toEqual([table, 0]);
  }
  expect(await names('firms')).toEqual(['A B Infra', 'Jayraj Infra']);
  expect(await names('sites')).toEqual(['SVG Site']);
  expect(await names('parties')).toEqual(['Ansari Enterprise', 'SVG Client']);
  expect(await names('materials')).toEqual(['Cement']);
  expect(await names('money_accounts')).not.toContain('DEMO Bank');
  const people = (await db.query<{ full_name: string }>('select full_name from profiles')).rows.map((r) => r.full_name);
  expect(people).toContain('Ramesh');
  expect(people).not.toContain('DEMO Office');
  expect(await count(`auth.users where email = 'demo office@example.test'`)).toBe(0);
  // Everything deleted is in the backup.
  expect(await count('golive_backup_20261101.entries')).toBe(entriesBefore);
  expect(await names('golive_backup_20261101.parties')).toContain('Test Vendor');

  // The books start again at 000001, and are append-only again.
  const first = await post(openingVendorBalance({ firmId: seed.jayraj, vendorId: seed.ansari, amountPaise: 5_00, asOf: '2026-11-01' }));
  expect(first.serial).toMatch(/000001$/);
  await expect(db.query('delete from entries')).rejects.toThrow('append-only');
});

it('changes nothing when a listed name does not exist', async () => {
  await postEntry(db, openingVendorBalance({ firmId: seed.jayraj, vendorId: seed.ansari, amountPaise: 1_00, asOf: '2026-10-21' }), OWNER);
  const before = await count('entries');
  await expect(db.exec(withList('parties', ['Test Vendr']))).rejects.toThrow('not found (check the spelling): party "Test Vendr"');
  expect(await count('entries')).toBe(before);
  expect(await count(`information_schema.schemata where schema_name = 'golive_backup_20261101'`)).toBe(0);
});

it('is one statement and keeps nothing between statements, so the SQL Editor runs it all or nothing', () => {
  const body = SCRIPT.replace(/--[^\n]*/g, '');
  expect(body).not.toMatch(/\b(begin|commit)\s*;/i);
  expect(body).not.toMatch(/temp(orary)? table/i);
  expect(body.match(/do \$\$/g)).toHaveLength(1);
});
