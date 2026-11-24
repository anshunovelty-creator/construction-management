import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import type { EntryDraft } from '@/lib/ledger/types';
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

it('refuses to move money between firms as any other kind of entry, even if the lines balance', async () => {
  const draft: EntryDraft = {
    id: crypto.randomUUID(),
    entryType: 'owner_capital',
    entryDate: '2026-10-29',
    firmId: seed.jayraj,
    lines: [
      { account: 'money', amountPaise: 1_000, firmId: seed.ab, moneyAccountId: seed.abBank.id },
      { account: 'money', amountPaise: -1_000, firmId: seed.jayraj, moneyAccountId: seed.jayrajBank.id },
      { account: 'inter_firm', amountPaise: 1_000, firmId: seed.jayraj, counterFirmId: seed.ab },
      { account: 'inter_firm', amountPaise: -1_000, firmId: seed.ab, counterFirmId: seed.jayraj },
    ],
  };
  await expect(postEntry(db, draft, OWNER)).rejects.toThrow('this kind of entry cannot move money between firms');
  const { rows } = await db.query('select count(*)::int as n from entries');
  expect(rows[0]).toEqual({ n: 0 });
});

it('lets a firm pay a vendor from its own cash, once there is cash to pay from', async () => {
  const cash = seed.ownerCash.id;
  const { vendorPayment } = await import('@/lib/ledger/posting/vendor');
  const { openingMoneyBalance } = await import('@/lib/ledger/posting/opening');
  const account = { id: cash, kind: 'owner_cash' as const, firmId: seed.jayraj };
  await postEntry(db, openingMoneyBalance({ account, amountPaise: 5_000_00, asOf: '2026-10-30' }), OWNER);
  await postEntry(db, vendorPayment({
    billFirmId: seed.jayraj, vendorId: seed.ansari, from: account,
    amountPaise: 1_000_00, paymentDate: '2026-10-31',
  }), OWNER);
  const { rows } = await db.query('select firm_id, amount_paise from entry_lines where money_account_id = $1 and amount_paise < 0', [cash]);
  expect(rows).toEqual([{ firm_id: seed.jayraj, amount_paise: -1_000_00 }]);
});
