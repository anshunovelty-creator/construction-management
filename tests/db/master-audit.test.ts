import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asUser, createMigratedDb, createUser, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let owner: string;
let office: string;

interface Change {
  action: string;
  row_key: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_by: string | null;
}

const changes = async (table: string, action: string): Promise<Change[]> =>
  (
    await db.query<Change>(
      'select action, row_key, old_row, new_row, changed_by from master_changes where table_name = $1 and action = $2 order by id',
      [table, action],
    )
  ).rows;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  owner = await createUser(db, 'owner', 'Owner');
  office = await createUser(db, 'office', 'Priya', { firms: [seed.ab] });
});

describe('master data change history', () => {
  it('records who changed a vendor, with the old and new values', async () => {
    await asUser(db, owner, (tx) => tx.query(`update parties set phone = '9876543210' where id = $1`, [seed.ansari]));
    const [change] = await changes('parties', 'update');
    expect(change).toMatchObject({ row_key: seed.ansari, changed_by: owner });
    expect(change!.old_row).toMatchObject({ name: 'Ansari Enterprise', phone: '' });
    expect(change!.new_row).toMatchObject({ name: 'Ansari Enterprise', phone: '9876543210' });
  });

  it('skips updates that change nothing', async () => {
    await asUser(db, owner, (tx) => tx.query('update parties set phone = phone where id = $1', [seed.ansari]));
    expect(await changes('parties', 'update')).toEqual([]);
  });

  it('records assignments being removed', async () => {
    await asUser(db, owner, (tx) => tx.query('delete from user_firms where user_id = $1', [office]));
    const [change] = await changes('user_firms', 'delete');
    expect(change).toMatchObject({ row_key: office, changed_by: owner, new_row: null });
    expect(change!.old_row).toMatchObject({ firm_id: seed.ab });
  });

  it('marks changes made with the service key (scripts) as made by no user', async () => {
    const created = await changes('firms', 'insert');
    expect(created.map((c) => c.changed_by)).toEqual([null, null]);
  });

  it('keeps the history append-only and visible only to the owner', async () => {
    await expect(db.query(`update master_changes set action = 'insert'`)).rejects.toThrow('append-only');
    await expect(db.query('delete from master_changes')).rejects.toThrow('append-only');
    const count = 'select count(*)::int as n from master_changes';
    expect((await asUser(db, office, (tx) => tx.query<{ n: number }>(count))).rows[0]!.n).toBe(0);
    expect((await asUser(db, owner, (tx) => tx.query<{ n: number }>(count))).rows[0]!.n).toBeGreaterThan(0);
  });
});
