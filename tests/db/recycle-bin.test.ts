import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { asUser, createMigratedDb, createUser, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let office: string;
let labour: string;
let OWNER: string;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  office = await createUser(db, 'office', 'Office');
  labour = await createUser(db, 'labour', 'Labour Clerk');
  OWNER = await createUser(db, 'owner', 'Owner');
});

const binDelete = (user: string, kind: string, id: string) =>
  asUser(db, user, (tx) => tx.query(`select app_bin_delete($1, $2)`, [kind, id]));
const bin = () => db.query<{ id: string; name: string; deleted_by: string; rows: unknown[] }>(`select * from recycle_bin`).then((r) => r.rows);

it('moves a deleted record into the bin, logs who deleted it, and puts it back with the same id', async () => {
  const site = (await db.query<{ id: string }>(`insert into sites (name) values ('Demo Site') returning id`)).rows[0]!.id;
  await binDelete(OWNER, 'sites', site);

  expect((await db.query(`select 1 from sites where id = $1`, [site])).rows).toHaveLength(0);
  const [item] = await bin();
  expect(item).toMatchObject({ name: 'Demo Site', deleted_by: OWNER });
  const { rows: log } = await db.query<{ changed_by: string }>(
    `select changed_by from master_changes where table_name = 'sites' and action = 'delete' and row_key = $1`, [site]);
  expect(log).toEqual([{ changed_by: OWNER }]);

  await asUser(db, OWNER, (tx) => tx.query(`select app_bin_restore($1)`, [item!.id]));
  expect((await db.query(`select name from sites where id = $1`, [site])).rows).toEqual([{ name: 'Demo Site' }]);
  expect(await bin()).toHaveLength(0);
});

it('keeps a machine’s service lines with it in the bin and brings them back', async () => {
  const machine = (await db.query<{ id: string }>(`insert into machines (name) values ('Test AJAX') returning id`)).rows[0]!.id;
  await asUser(db, OWNER, (tx) => tx.query(
    `insert into machine_services (machine_id, service_date, running_hours, cost_paise) values ($1, '2026-10-01', 100, 500)`, [machine]));
  await binDelete(OWNER, 'machines', machine);
  expect((await db.query(`select 1 from machine_services`)).rows).toHaveLength(0);
  await asUser(db, OWNER, async (tx) => tx.query(`select app_bin_restore(id) from recycle_bin`));
  expect((await db.query(`select running_hours::int as h from machine_services where machine_id = $1`, [machine])).rows).toEqual([{ h: 100 }]);
});

it('refuses what is still in use, and changes nothing', async () => {
  // The seeded work order uses the site.
  await expect(binDelete(OWNER, 'sites', seed.svgSite)).rejects.toThrow('foreign key');
  expect((await db.query(`select 1 from sites where id = $1`, [seed.svgSite])).rows).toHaveLength(1);
  expect(await bin()).toHaveLength(0);
});

it('never deletes a firm, and lets only the owner delete Setup records', async () => {
  await expect(binDelete(OWNER, 'firms', seed.jayraj)).rejects.toThrow('not_allowed');
  const site = (await db.query<{ id: string }>(`insert into sites (name) values ('Demo Site') returning id`)).rows[0]!.id;
  await expect(binDelete(office, 'sites', site)).rejects.toThrow('not_allowed');
});

it('lets the office or labour login delete a labour worker only while no month is saved', async () => {
  const worker = (await db.query<{ id: string }>(
    `insert into labour_workers (name, kind, joined_on) values ('Test Raju', 'worker', '2026-11-01') returning id`)).rows[0]!.id;
  await db.query(`insert into labour_months (worker_id, month, present_days) values ($1, '2026-11-01', 5)`, [worker]);
  await expect(binDelete(labour, 'labour-workers', worker)).rejects.toThrow('has_months');
  await db.query(`delete from labour_months`);
  await binDelete(labour, 'labour-workers', worker);
  expect((await bin())[0]).toMatchObject({ name: 'Test Raju', deleted_by: labour });
});

it('shows the bin to the owner only', async () => {
  const site = (await db.query<{ id: string }>(`insert into sites (name) values ('Demo Site') returning id`)).rows[0]!.id;
  await binDelete(OWNER, 'sites', site);
  const count = (user: string) => asUser(db, user, (tx) => tx.query<{ n: number }>(`select count(*)::int as n from recycle_bin`)).then((r) => r.rows[0]!.n);
  expect(await count(OWNER)).toBe(1);
  expect(await count(office)).toBe(0);
  expect(await count(labour)).toBe(0);
});
