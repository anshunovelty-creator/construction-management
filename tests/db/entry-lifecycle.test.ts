import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entryStatus, rejectEntry, replaceEntry, reverseEntry, verifyEntry } from '@/lib/ledger/lifecycle';
import { postEntry } from '@/lib/ledger/repo';
import {
  balanceOf,
  createMigratedDb,
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

describe('cancelling an entry', () => {
  it('posts exactly opposite lines and marks the original cancelled', async () => {
    const posted = await postEntry(db, ownerToRamesh(seed, 2_000_000), OFFICE);
    const reversal = await reverseEntry(db, posted.id, OWNER, 'entered twice');
    expect(reversal.serial).toBe('CM/26-27/000002');
    expect(await balanceOf(db, 'money', { money_account_id: seed.rameshCash.id })).toBe(0);
    expect(await entryStatus(db, posted.id)).toBe('cancelled');
    expect(await entryStatus(db, reversal.id)).toBe('reversal');
    await expect(reverseEntry(db, posted.id, OWNER, 'again')).rejects.toThrow('already cancelled');
    await expect(reverseEntry(db, reversal.id, OWNER, 'undo')).rejects.toThrow('is itself a reversal');
  });

  it('needs a reason', async () => {
    const posted = await postEntry(db, ownerToRamesh(seed, 100), OFFICE);
    await expect(reverseEntry(db, posted.id, OWNER, '  ')).rejects.toThrow('a reason is required');
  });
});

describe('verifying and rejecting', () => {
  it('lets someone else verify an entry, but never the person who entered it', async () => {
    const posted = await postEntry(db, ownerToRamesh(seed, 100), SUPERVISOR);
    expect(await entryStatus(db, posted.id)).toBe('unverified');
    await expect(verifyEntry(db, posted.id, SUPERVISOR)).rejects.toThrow('cannot verify your own entry');
    await verifyEntry(db, posted.id, OFFICE);
    expect(await entryStatus(db, posted.id)).toBe('verified');
    await expect(verifyEntry(db, posted.id, OWNER)).rejects.toThrow('already verified');
  });

  it('rejects an unverified entry by reversing it, but not your own or a verified one', async () => {
    const posted = await postEntry(db, ownerToRamesh(seed, 100), SUPERVISOR);
    await expect(rejectEntry(db, posted.id, SUPERVISOR, 'oops')).rejects.toThrow('cannot reject your own entry');
    await rejectEntry(db, posted.id, OFFICE, 'Ramesh did not receive this cash');
    expect(await entryStatus(db, posted.id)).toBe('cancelled');
    expect(await balanceOf(db, 'money', { money_account_id: seed.rameshCash.id })).toBe(0);

    const verified = await postEntry(db, ownerToRamesh(seed, 100), SUPERVISOR);
    await verifyEntry(db, verified.id, OFFICE);
    await expect(rejectEntry(db, verified.id, OWNER, 'late')).rejects.toThrow('already verified');
  });
});

describe('replacing (editing) an entry', () => {
  it('cancels the old entry and posts the corrected one, linked', async () => {
    const posted = await postEntry(db, ownerToRamesh(seed, 2_000_000), OFFICE);
    const result = await replaceEntry(db, posted.id, ownerToRamesh(seed, 1_500_000), OWNER, 'amount was ₹15,000');
    expect(await balanceOf(db, 'money', { money_account_id: seed.rameshCash.id })).toBe(1_500_000);
    expect(await entryStatus(db, posted.id)).toBe('cancelled');
    expect(await entryStatus(db, result.entry.id)).toBe('unverified');
    const { rows } = await db.query<{ replaces_entry_id: string }>(
      'select replaces_entry_id from entries where id = $1',
      [result.entry.id],
    );
    expect(rows[0]!.replaces_entry_id).toBe(posted.id);
  });
});
