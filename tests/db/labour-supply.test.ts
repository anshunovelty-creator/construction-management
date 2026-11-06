import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { asUser, createMigratedDb, createUser, seedBasics } from './harness';

let template: PGlite;
let db: PGliteInterface;
let labour: string;
let supervisor: string;
let office: string;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  const seed = await seedBasics(db);
  labour = await createUser(db, 'labour', 'Labour Clerk');
  supervisor = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  office = await createUser(db, 'office', 'Office');
});

const addWorker = (tx: Pick<PGliteInterface, 'query'>, kind = 'worker') => tx.query<{ id: string }>(
  `insert into labour_workers (name, kind, joined_on) values ('Sonu', $1, '2026-01-01') returning id`, [kind]).then((r) => r.rows[0]!.id);

it('shows a Labour login nothing of the firms, in any table or view', async () => {
  const { rows: names } = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_name not like 'labour%'`);
  expect(names.length).toBeGreaterThan(20);
  const seen: Record<string, number> = {};
  await asUser(db, labour, async (tx) => {
    for (const { table_name } of names) {
      await tx.exec('savepoint s');
      try {
        const { rows } = await tx.query<{ n: number }>(`select count(*)::int as n from "${table_name}"`);
        if (rows[0]!.n > 0) seen[table_name] = rows[0]!.n;
      } catch {
        await tx.exec('rollback to savepoint s'); // no grant at all: nothing to see
      }
    }
  });
  expect(seen).toEqual({ profiles: 1 }); // their own profile only
});

it('gives a Labour login nothing through the functions that run with raised rights', async () => {
  await asUser(db, labour, async (tx) => {
    await expect(tx.query(`select app_assert_can_post($1::jsonb)`, [JSON.stringify({ entryType: 'vendor_payment', entryDate: '2026-10-01', lines: [] })])).rejects.toThrow();
  });
  await asUser(db, labour, async (tx) => {
    await expect(tx.query(`select app_lock_books('2026-10-01', 'x')`)).rejects.toThrow('only the owner');
  });
});

it('lets a Labour login keep workers and their months', async () => {
  await asUser(db, labour, async (tx) => {
    const id = await addWorker(tx);
    await tx.query(`insert into labour_rates (worker_id, from_month, rate_paise) values ($1, '2026-01-01', 80000)`, [id]);
    // 35 days in a month of 31: double duties are allowed.
    await tx.query(`insert into labour_months (worker_id, month, present_days, ot_hours, advance_paise, paid_paise) values ($1, '2026-10-01', 35, 40, 50000, 3000000)`, [id]);
    await tx.query(`update labour_months set paid_paise = 2500000 where worker_id = $1`, [id]);
    const { rows } = await tx.query<{ present_days: string; paid_paise: string }>(`select present_days, paid_paise from labour_months`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ present_days: '35.00' });
    expect(Number(rows[0]!.paid_paise)).toBe(2_500_000);
    expect((await tx.query(`delete from labour_months where worker_id = $1`, [id])).affectedRows).toBe(1);
  });
});

it('keeps supervisors out, and lets the office in', async () => {
  const id = await asUser(db, office, async (tx) => addWorker(tx));
  await asUser(db, supervisor, async (tx) => {
    expect((await tx.query(`select * from labour_workers`)).rows).toEqual([]);
    await expect(tx.query(`insert into labour_months (worker_id, month) values ($1, '2026-10-01')`, [id])).rejects.toThrow('row-level security');
  });
  await asUser(db, office, async (tx) => {
    await tx.query(`insert into labour_months (worker_id, month, present_days) values ($1, '2026-10-01', 20)`, [id]);
  });
});

it('refuses a second line for the same month and figures that make no sense', async () => {
  await asUser(db, labour, async (tx) => {
    const id = await addWorker(tx);
    await tx.query(`insert into labour_months (worker_id, month) values ($1, '2026-10-01')`, [id]);
    await tx.exec('savepoint a');
    const refused = async (sql: string, why: string) => {
      await expect(tx.query(sql, [id])).rejects.toThrow(why);
      await tx.exec('rollback to savepoint a');
    };
    await refused(`insert into labour_months (worker_id, month) values ($1, '2026-10-01')`, 'unique');
    await refused(`insert into labour_months (worker_id, month) values ($1, '2026-11-05')`, 'check constraint');
    await refused(`insert into labour_months (worker_id, month, present_days) values ($1, '2026-11-01', 101)`, 'check constraint');
    await refused(`insert into labour_months (worker_id, month, paid_paise) values ($1, '2026-11-01', -1)`, 'check constraint');
  });
});
