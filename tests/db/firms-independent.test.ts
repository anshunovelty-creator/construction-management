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
