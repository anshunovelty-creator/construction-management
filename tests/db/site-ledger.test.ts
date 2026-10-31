import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { reverseEntry } from '@/lib/ledger/lifecycle';
import { siteCashExpense } from '@/lib/ledger/posting/cash';
import { clientBill } from '@/lib/ledger/posting/client';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import { postEntry } from '@/lib/ledger/repo';
import { createMigratedDb, OWNER, seedBasics, SUPERVISOR, type Seed } from './harness';

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

it('lists what was spent at a site and what the client was billed, leaving out payments and cancelled entries', async () => {
  const post = (draft: Parameters<typeof postEntry>[1], by = OWNER) => postEntry(db, draft, by);
  await post(vendorBill({
    firmId: seed.jayraj, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-10-22', billNo: 'B-1',
    items: [{ costHead: 'material', amountPaise: 500_00 }, { costHead: 'material', amountPaise: 200_00 }], gstPaise: 126_00,
  }));
  // A payment names only the vendor, so it is not on the site's statement.
  await post(vendorPayment({
    billFirmId: seed.jayraj, vendorId: seed.ansari, from: seed.jayrajBank, amountPaise: 300_00, paymentDate: '2026-10-23', reference: 'UTR1',
  }));
  // Supervisor cash belongs to no firm: a common cost.
  await post(siteCashExpense({
    from: seed.rameshCash, siteId: seed.svgSite, costHead: 'labour', amountPaise: 150_00, expenseDate: '2026-10-24', narration: 'Labour',
  }), SUPERVISOR);
  await post(clientBill({
    client: seed.client, billDate: '2026-10-25', billNo: 'RA-1', grossPaise: 2_000_00, gstPaise: 360_00,
    deductions: { tdsPaise: 20_00, materialRecoveryPaise: 40_00 },
  }));
  const wrong = await post(vendorBill({
    firmId: seed.jayraj, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-10-26', billNo: 'B-WRONG',
    items: [{ costHead: 'material', amountPaise: 999_00 }],
  }));
  await reverseEntry(db, wrong.id, OWNER, 'typed twice');

  const { rows } = await db.query(
    `select entry_type, firm_id, party_id, cost_paise, billed_paise from site_rows where site_id = $1 order by entry_date`,
    [seed.svgSite],
  );
  expect(rows).toEqual([
    // Cost before GST: both items, no GST.
    { entry_type: 'vendor_bill', firm_id: seed.jayraj, party_id: seed.ansari, cost_paise: 700_00, billed_paise: 0 },
    { entry_type: 'site_cash_expense', firm_id: null, party_id: null, cost_paise: 150_00, billed_paise: 0 },
    // Gross before GST is billed; material the client supplied and cut from the bill is a cost of the site.
    { entry_type: 'client_bill', firm_id: seed.jayraj, party_id: seed.svgClient, cost_paise: 40_00, billed_paise: 2_000_00 },
  ]);
});
