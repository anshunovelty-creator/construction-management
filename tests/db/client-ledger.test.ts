import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { reverseEntry } from '@/lib/ledger/lifecycle';
import { clientBill, clientReceipt } from '@/lib/ledger/posting/client';
import { openingClientBalance } from '@/lib/ledger/posting/opening';
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

it('adds up opening, bills (gross, deductions) and receipts per firm and client, leaving out cancelled entries', async () => {
  const post = (draft: Parameters<typeof postEntry>[1]) => postEntry(db, draft, OWNER);
  await post(openingClientBalance({ workOrder: seed.workOrder, amountPaise: 2_000_00, asOf: '2026-10-21' }));
  await post(clientBill({
    workOrder: seed.workOrder, billDate: '2026-10-22', billNo: 'RA-1', grossPaise: 10_000_00,
    deductions: { tdsPaise: 100_00, retentionPaise: 500_00, securityDepositPaise: 200_00, otherPaise: 50_00 },
  }));
  await post(clientReceipt({
    workOrder: seed.workOrder, to: seed.jayrajBank, amountPaise: 4_000_00, receiptDate: '2026-10-23', reference: 'UTR9',
  }));
  const wrong = await post(clientReceipt({
    workOrder: seed.workOrder, to: seed.jayrajBank, amountPaise: 999_00, receiptDate: '2026-10-24', reference: 'UTR-WRONG',
  }));
  await reverseEntry(db, wrong.id, OWNER, 'typed twice');

  const { rows } = await db.query('select * from client_totals');
  expect(rows).toEqual([{
    firm_id: seed.jayraj, party_id: seed.svgClient,
    opening_paise: 2_000_00, gross_paise: 10_000_00, deductions_paise: 850_00, received_paise: 4_000_00,
    last_receipt: new Date('2026-10-23'),
  }]);

  const detail = await db.query<Record<string, unknown>>(
    `select entry_type, site_id, gross_paise, tds_paise, receivable_paise, money_account_id from client_rows order by entry_date`,
  );
  expect(detail.rows).toEqual([
    { entry_type: 'opening', site_id: seed.svgSite, gross_paise: 0, tds_paise: 0, receivable_paise: 2_000_00, money_account_id: null },
    { entry_type: 'client_bill', site_id: seed.svgSite, gross_paise: 10_000_00, tds_paise: 100_00, receivable_paise: 9_150_00, money_account_id: null },
    { entry_type: 'client_receipt', site_id: seed.svgSite, gross_paise: 0, tds_paise: 0, receivable_paise: -4_000_00, money_account_id: seed.jayrajBank.id },
  ]);
});
