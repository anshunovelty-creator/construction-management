import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postEntry } from '@/lib/ledger/repo';
import type { EntryDraft } from '@/lib/ledger/types';
import { createMigratedDb, OFFICE, ownerToRamesh, seedBasics, type Seed } from './harness';

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

describe('database guards on the ledger', () => {
  it('rejects an entry whose lines do not sum to zero, even through raw SQL', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          `insert into entries (id, serial, series, fy, seq, entry_type, entry_date, created_by)
           values ($1, 'CM/26-27/000099', 'CM', '26-27', 99, 'cash_transfer', '2026-10-22', $2)`,
          ['11111111-1111-4111-8111-111111111111', OFFICE],
        );
        await tx.query(
          `insert into entry_lines (entry_id, line_no, account, amount_paise, money_account_id)
           values ($1, 1, 'money', 500, $2), ($1, 2, 'money', -400, $3)`,
          ['11111111-1111-4111-8111-111111111111', seed.rameshCash.id, seed.ownerCash.id],
        );
      }),
    ).rejects.toThrow('does not balance');
  });

  it('rejects an entry with a single line', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          `insert into entries (id, serial, series, fy, seq, entry_type, entry_date, created_by)
           values ($1, 'CM/26-27/000098', 'CM', '26-27', 98, 'cash_transfer', '2026-10-22', $2)`,
          ['22222222-2222-4222-8222-222222222222', OFFICE],
        );
      }),
    ).rejects.toThrow('needs at least two lines');
  });

  it('never allows ledger rows to be updated, deleted or truncated', async () => {
    await postEntry(db, ownerToRamesh(seed, 100_000), OFFICE);
    await expect(db.query(`update entry_lines set amount_paise = 1`)).rejects.toThrow('append-only');
    await expect(db.query(`delete from entry_lines`)).rejects.toThrow('append-only');
    await expect(db.query(`update entries set narration = 'changed'`)).rejects.toThrow('append-only');
    await expect(db.query(`delete from entries`)).rejects.toThrow('append-only');
    await expect(db.query(`truncate entry_lines cascade`)).rejects.toThrow('append-only');
  });

  it('refuses extra lines added to an existing entry later', async () => {
    const { id } = await postEntry(db, ownerToRamesh(seed, 100_000), OFFICE);
    await expect(
      db.query(
        `insert into entry_lines (entry_id, line_no, account, amount_paise, money_account_id)
         values ($1, 3, 'money', 100, $2), ($1, 4, 'money', -100, $3)`,
        [id, seed.rameshCash.id, seed.ownerCash.id],
      ),
    ).rejects.toThrow('lines can only be added in the transaction that creates entry');
  });

  it('requires a money line to carry the firm of its bank account', async () => {
    const draft = ownerToRamesh(seed, 100_000);
    draft.lines = [
      { account: 'money', amountPaise: 100_000, firmId: seed.ab, moneyAccountId: seed.jayrajBank.id },
      { account: 'money', amountPaise: -100_000, moneyAccountId: seed.ownerCash.id },
    ];
    await expect(postEntry(db, draft, OFFICE)).rejects.toThrow('money line firm must match');
  });

  it('requires work-order lines to agree with the work order firm, site and client', async () => {
    const draft: EntryDraft = {
      id: crypto.randomUUID(),
      entryType: 'opening',
      entryDate: '2026-10-21',
      firmId: seed.ab,
      lines: [
        {
          account: 'client_receivable',
          amountPaise: 100_000,
          firmId: seed.ab, // the work order belongs to Jayraj
          partyId: seed.svgClient,
          siteId: seed.svgSite,
          workOrderId: seed.workOrder.id,
        },
        { account: 'opening_balance', amountPaise: -100_000 },
      ],
    };
    await expect(postEntry(db, draft, OFFICE)).rejects.toThrow('line does not match work order');
  });
});
