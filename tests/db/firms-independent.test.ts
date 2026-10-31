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

it('refuses a new entry that moves money from one firm to another, even if the lines balance', async () => {
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
  await expect(postEntry(db, draft, OWNER)).rejects.toThrow('firms are independent');
  const { rows } = await db.query('select count(*)::int as n from entries');
  expect(rows[0]).toEqual({ n: 0 });
});

it('lets a firm keep its own cash and pay a vendor from it; banks still need a firm, supervisor cash still has none', async () => {
  const add = (kind: string, name: string, firmId: string | null) =>
    db.query<{ id: string }>('insert into money_accounts (kind, name, firm_id) values ($1, $2, $3) returning id', [kind, name, firmId]);
  const cash = (await add('owner_cash', 'Jayraj Infra - Cash', seed.jayraj)).rows[0]!.id;
  // Common owner cash (no firm) is still allowed.
  await add('owner_cash', 'Owner cash 2', null);
  await expect(add('bank', 'Bank with no firm', null)).rejects.toThrow(/money_accounts_check/);
  await expect(add('supervisor_cash', 'Supervisor cash with a firm', seed.jayraj)).rejects.toThrow(/money_accounts_check/);

  const { vendorPayment } = await import('@/lib/ledger/posting/vendor');
  await postEntry(db, vendorPayment({
    billFirmId: seed.jayraj, vendorId: seed.ansari, from: { id: cash, kind: 'owner_cash', firmId: seed.jayraj },
    amountPaise: 1_000_00, paymentDate: '2026-10-31',
  }), OWNER);
  const { rows } = await db.query('select firm_id, amount_paise from entry_lines where money_account_id = $1', [cash]);
  expect(rows).toEqual([{ firm_id: seed.jayraj, amount_paise: -1_000_00 }]);
});
