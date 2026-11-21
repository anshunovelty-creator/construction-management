import type { PGliteInterface } from '@electric-sql/pglite';
import { beforeEach, expect, it } from 'vitest';
import { asUser, createMigratedDb, createUser, seedBasics } from './harness';

let db: PGliteInterface;
let office: string;
let supervisor: string;
let worker: string;
let vendor: string;

beforeEach(async () => {
  db = await createMigratedDb();
  const seed = await seedBasics(db);
  vendor = seed.ansari;
  office = await createUser(db, 'office', 'Office');
  supervisor = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  worker = (await db.query<{ id: string }>(`insert into parties (kind, name, rate_paise) values ('worker', 'Raju', 7000) returning id`)).rows[0]!.id;
});

const addMoney = (tx: Pick<PGliteInterface, 'query'>, party: string, kind: string, method: string | null, note = '') =>
  tx.query(`insert into salary_money (party_id, money_date, kind, amount_paise, method, note) values ($1, '2026-11-10', $2, 50000, $3, $4)`,
    [party, kind, method, note]);

it('keeps advances, deductions and PF switches for workers and staff, kept by the office only', async () => {
  await asUser(db, office, async (tx) => {
    await addMoney(tx, worker, 'advance', 'cash');
    await tx.query(`insert into salary_pf (party_id, from_month, cut) values ($1, '2026-11-01', true)`, [worker]);
    await tx.exec('savepoint s');
    await expect(addMoney(tx, worker, 'deduction', null)).rejects.toThrow(); // a deduction says why
    await tx.exec('rollback to savepoint s');
    await expect(addMoney(tx, vendor, 'advance', 'cash')).rejects.toThrow('not a worker or staff');
  });
  await asUser(db, supervisor, async (tx) => {
    expect((await tx.query(`select * from salary_money`)).rows).toHaveLength(0);
    await expect(addMoney(tx, worker, 'advance', 'cash')).rejects.toThrow();
  });
});
