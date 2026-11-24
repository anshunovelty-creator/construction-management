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
    // Money given is kept with the account it came from (app_pay); only a deduction is a line of its own.
    await addMoney(tx, worker, 'deduction', null, 'Mess');
    await tx.query(`insert into salary_pf (party_id, from_month, cut) values ($1, '2026-11-01', true)`, [worker]);
    await tx.exec('savepoint s');
    await expect(addMoney(tx, worker, 'deduction', null)).rejects.toThrow(); // a deduction says why
    await tx.exec('rollback to savepoint s');
    await expect(addMoney(tx, worker, 'advance', 'cash')).rejects.toThrow('row-level security');
    await tx.exec('rollback to savepoint s');
    await expect(addMoney(tx, vendor, 'deduction', null, 'x')).rejects.toThrow('not a worker or staff');
  });
  await asUser(db, supervisor, async (tx) => {
    expect((await tx.query(`select * from salary_money`)).rows).toHaveLength(0);
    await expect(addMoney(tx, worker, 'deduction', null, 'x')).rejects.toThrow();
  });
});

it('keeps one opening balance per worker or staff member, kept by the office only', async () => {
  const open = (tx: Pick<PGliteInterface, 'query'>, party: string, amount: number) =>
    tx.query(`insert into salary_openings (party_id, month, amount_paise) values ($1, '2026-10-01', $2)
      on conflict (party_id) do update set amount_paise = excluded.amount_paise`, [party, amount]);
  await asUser(db, office, async (tx) => {
    await open(tx, worker, 300000);
    await open(tx, worker, -20000); // saving again replaces it
    expect((await tx.query(`select amount_paise from salary_openings`)).rows).toEqual([{ amount_paise: -20000 }]);
    await expect(open(tx, vendor, 100)).rejects.toThrow('not a worker or staff');
  });
  await asUser(db, supervisor, async (tx) => {
    expect((await tx.query(`select * from salary_openings`)).rows).toHaveLength(0);
    await expect(open(tx, worker, 100)).rejects.toThrow();
  });
});

it('keeps one typed month per worker, kept by the office only, and never from the daily report', async () => {
  const type = (tx: Pick<PGliteInterface, 'query'>, party: string, days: number) =>
    tx.query(`insert into salary_months (party_id, month, days, ot_hours, salary_paise) values ($1, '2026-11-01', $2, 4, 1456000)
      on conflict (party_id, month) do update set days = excluded.days`, [party, days]);
  const site = (await db.query<{ id: string }>(`select site_id as id from user_sites limit 1`)).rows[0]!.id;
  await asUser(db, supervisor, async (tx) => {
    await tx.query(`insert into labour_day (site_id, work_date, party_id, present, day_pay_paise, amount_paise)
      values ($1, '2026-11-02', $2, true, 56000, 56000)`, [site, worker]);
  });
  await asUser(db, office, async (tx) => {
    expect((await tx.query(`select * from salary_months`)).rows).toHaveLength(0); // the report's day paid nobody
    await type(tx, worker, 20);
    await type(tx, worker, 26);
    expect((await tx.query(`select days::float, salary_paise::int from salary_months`)).rows).toEqual([{ days: 26, salary_paise: 1456000 }]);
    await expect(type(tx, vendor, 1)).rejects.toThrow('not a worker or staff');
  });
  await asUser(db, supervisor, async (tx) => {
    expect((await tx.query(`select * from salary_months`)).rows).toHaveLength(0);
    await expect(type(tx, worker, 1)).rejects.toThrow('row-level security');
  });
});
