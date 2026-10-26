import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asUser, createMigratedDb, createUser, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let owner: string;
let office: string; // assigned to A B Infra only
let supervisor: string;

const switchTo = (userId: string, firmId: string) =>
  asUser(db, userId, (tx) => tx.query('select app_set_my_firm($1)', [firmId]));

const savedFirm = async (userId: string) =>
  (await db.query<{ firm_id: string }>('select firm_id from working_firms where user_id = $1', [userId])).rows[0]?.firm_id;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  owner = await createUser(db, 'owner', 'Owner');
  office = await createUser(db, 'office', 'Priya', { firms: [seed.ab] });
  supervisor = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
});

describe('working firm', () => {
  it('lets the owner switch to either firm, keeping one row', async () => {
    await switchTo(owner, seed.ab);
    expect(await savedFirm(owner)).toBe(seed.ab);
    await switchTo(owner, seed.jayraj);
    expect(await savedFirm(owner)).toBe(seed.jayraj);
    const { rows } = await db.query('select count(*)::int as n from working_firms where user_id = $1', [owner]);
    expect(rows).toEqual([{ n: 1 }]);
  });

  it('lets office staff switch only to their assigned firms', async () => {
    await switchTo(office, seed.ab);
    expect(await savedFirm(office)).toBe(seed.ab);
    await expect(switchTo(office, seed.jayraj)).rejects.toThrow('not assigned to this firm');
    expect(await savedFirm(office)).toBe(seed.ab);
  });

  it('refuses supervisors and deactivated users', async () => {
    await expect(switchTo(supervisor, seed.ab)).rejects.toThrow('not assigned to this firm');
    await db.query('update profiles set is_active = false where user_id = $1', [office]);
    await expect(switchTo(office, seed.ab)).rejects.toThrow('deactivated');
  });

  it('shows each person only their own choice and allows no direct writes', async () => {
    await switchTo(owner, seed.jayraj);
    await switchTo(office, seed.ab);
    const seen = await asUser(db, office, (tx) => tx.query('select user_id, firm_id from working_firms'));
    expect(seen.rows).toEqual([{ user_id: office, firm_id: seed.ab }]);
    await expect(
      asUser(db, office, (tx) => tx.query('update working_firms set firm_id = $1 where user_id = $2', [seed.jayraj, office])),
    ).rejects.toThrow('permission denied');
  });

  it('leaves nothing in the change log', async () => {
    const before = await db.query('select count(*)::int as n from master_changes');
    await switchTo(owner, seed.ab);
    await switchTo(owner, seed.jayraj);
    expect((await db.query('select count(*)::int as n from master_changes')).rows).toEqual(before.rows);
  });
});
