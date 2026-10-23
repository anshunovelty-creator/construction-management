import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lockBooks, postEntry } from '@/lib/ledger/repo';
import type { EntryDraft } from '@/lib/ledger/types';
import {
  balanceOf,
  createMigratedDb,
  jayrajBankToOwner,
  OFFICE,
  OWNER,
  ownerToRamesh,
  seedBasics,
  SUPERVISOR,
  type Seed,
} from './harness';

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

describe('serial numbers', () => {
  it('numbers entries per firm series and financial year', async () => {
    expect((await postEntry(db, ownerToRamesh(seed, 100), OFFICE)).serial).toBe('CM/26-27/000001');
    expect((await postEntry(db, ownerToRamesh(seed, 100), OFFICE)).serial).toBe('CM/26-27/000002');
    expect((await postEntry(db, jayrajBankToOwner(seed, 100), OFFICE)).serial).toBe('JI/26-27/000001');
    expect((await postEntry(db, ownerToRamesh(seed, 100, '2026-03-31'), OFFICE)).serial).toBe('CM/25-26/000001');
  });

  it('does not skip a number when a save fails', async () => {
    await postEntry(db, ownerToRamesh(seed, 100), OFFICE);
    const broken = ownerToRamesh(seed, 100);
    broken.lines[0] = { account: 'vendor_payable', amountPaise: 100, firmId: seed.jayraj }; // missing vendor
    await expect(postEntry(db, broken, OFFICE)).rejects.toThrow('line_dimensions');
    expect((await postEntry(db, ownerToRamesh(seed, 100), OFFICE)).serial).toBe('CM/26-27/000002');
  });
});

describe('post_entry', () => {
  it('treats a repeated id as the same entry (offline retry)', async () => {
    const draft = ownerToRamesh(seed, 546_000);
    const first = await postEntry(db, draft, SUPERVISOR);
    const second = await postEntry(db, draft, SUPERVISOR);
    expect(second).toEqual({ id: first.id, serial: first.serial, duplicate: true });
    expect(await balanceOf(db, 'money', { money_account_id: seed.rameshCash.id })).toBe(546_000);
  });

  it('refuses to post reversals directly', async () => {
    const draft = { ...ownerToRamesh(seed, 100), entryType: 'reversal' } as unknown as EntryDraft;
    await expect(postEntry(db, draft, OFFICE)).rejects.toThrow('use reverse_entry or replace_entry');
  });
});

describe('locking the books', () => {
  it('blocks posting on or before the lock date unless a reason is given, and records the override', async () => {
    await lockBooks(db, '2026-10-21', OWNER);
    await expect(postEntry(db, ownerToRamesh(seed, 100, '2026-10-21'), OFFICE)).rejects.toThrow(
      'books are locked through',
    );
    await postEntry(db, ownerToRamesh(seed, 100, '2026-10-22'), OFFICE);

    const late = await postEntry(db, ownerToRamesh(seed, 100, '2026-10-20'), OWNER, 'bill found late');
    const { rows } = await db.query<{ kind: string; reason: string }>(
      'select kind, reason from entry_events where entry_id = $1',
      [late.id],
    );
    expect(rows).toEqual([{ kind: 'lock_override', reason: 'bill found late' }]);
  });

  it('needs a reason to move the lock date back', async () => {
    await lockBooks(db, '2026-10-21', OWNER);
    await expect(lockBooks(db, '2026-09-30', OWNER)).rejects.toThrow('needs a reason');
    await lockBooks(db, '2026-09-30', OWNER, 'correcting September cash');
  });
});
