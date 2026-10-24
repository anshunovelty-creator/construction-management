import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { reverseEntry } from '@/lib/ledger/lifecycle';
import { openingVendorBalance } from '@/lib/ledger/posting/opening';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import { postEntry } from '@/lib/ledger/repo';
import { createMigratedDb, OWNER, seedBasics, type Seed } from './harness';

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

it('adds up opening, bills and payments per firm and vendor, leaving out cancelled entries', async () => {
  const post = (draft: Parameters<typeof postEntry>[1]) => postEntry(db, draft, OWNER);
  await post(openingVendorBalance({ firmId: seed.jayraj, vendorId: seed.ansari, amountPaise: 1_000_00, asOf: '2026-10-21' }));
  const cement = (await db.query<{ id: string }>(`insert into materials (name) values ('Cement') returning id`)).rows[0]!.id;
  await post(vendorBill({
    firmId: seed.jayraj, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-10-22', billNo: 'B-1',
    items: [{ costHead: 'material', amountPaise: 500_00 }], materialId: cement,
  }));
  // Paid from A B Infra's bank, but the bill is Jayraj's: it still counts on Jayraj's page.
  await post(vendorPayment({
    billFirmId: seed.jayraj, vendorId: seed.ansari, from: seed.abBank, amountPaise: 300_00,
    paymentDate: '2026-10-23', reference: 'UTR1',
  }));
  const wrong = await post(vendorPayment({
    billFirmId: seed.jayraj, vendorId: seed.ansari, from: seed.ownerCash, amountPaise: 999_00, paymentDate: '2026-10-24',
  }));
  await reverseEntry(db, wrong.id, OWNER, 'typed twice');

  const { rows } = await db.query('select * from party_totals');
  expect(rows).toEqual([{
    firm_id: seed.jayraj, party_id: seed.ansari,
    opening_paise: 1_000_00, bills_paise: 500_00, paid_paise: 300_00, last_payment: new Date('2026-10-23'),
  }]);

  const detail = await db.query<{ entry_type: string; site_id: string | null; money_account_id: string | null; material_id: string | null }>(
    `select entry_type, site_id, money_account_id, material_id from party_rows order by entry_date`,
  );
  expect(detail.rows).toEqual([
    { entry_type: 'opening', site_id: null, money_account_id: null, material_id: null },
    { entry_type: 'vendor_bill', site_id: seed.svgSite, money_account_id: null, material_id: cement },
    { entry_type: 'vendor_payment', site_id: null, money_account_id: seed.abBank.id, material_id: null },
  ]);
});
