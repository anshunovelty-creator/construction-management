import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { reverseEntry } from '@/lib/ledger/lifecycle';
import { clientBill } from '@/lib/ledger/posting/client';
import { vendorBill } from '@/lib/ledger/posting/vendor';
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

it('lists each live bill with GST, before GST and the GST, for the GST record; bills with none and cancelled bills stay off', async () => {
  const bought = await postEntry(db, vendorBill({
    firmId: seed.jayraj, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-11-02', billNo: 'P-1',
    items: [{ costHead: 'material', amountPaise: 10_000_00 }], gstPaise: 1_800_00, tds: { rateBp: 100, section: '194C' },
  }), OWNER);
  await postEntry(db, vendorBill({
    firmId: seed.jayraj, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-11-03', billNo: 'P-2',
    items: [{ costHead: 'material', amountPaise: 5_000_00 }],
  }), OWNER);
  const sold = await postEntry(db, clientBill({
    client: seed.client, billDate: '2026-11-04', billNo: 'RA-1', grossPaise: 50_000_00, gstPaise: 9_000_00,
    deductions: { retentionPaise: 2_500_00 },
  }), OWNER);

  const rows = async () => (await db.query('select serial, entry_type, base_paise, gst_paise from gst_rows order by entry_date')).rows;
  expect(await rows()).toEqual([
    { serial: bought.serial, entry_type: 'vendor_bill', base_paise: 10_000_00, gst_paise: 1_800_00 },
    { serial: sold.serial, entry_type: 'client_bill', base_paise: 50_000_00, gst_paise: 9_000_00 },
  ]);
  await reverseEntry(db, sold.id, OWNER, 'wrong bill');
  expect(await rows()).toHaveLength(1);
});
