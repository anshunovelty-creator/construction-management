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

it('lets a Labour login keep workers, cards and money, but not the deduction rates', async () => {
  await asUser(db, labour, async (tx) => {
    const id = await addWorker(tx);
    await tx.query(`insert into labour_rates (worker_id, from_month, rate_paise) values ($1, '2026-01-01', 80000)`, [id]);
    await tx.query(`insert into labour_attendance (worker_id, work_date, present, ot_hours) values ($1, '2026-10-01', true, 2), ($1, '2026-10-02', false, 0)`, [id]);
    await tx.query(`insert into labour_money (worker_id, money_date, kind, amount_paise, method) values ($1, '2026-10-05', 'advance', 50000, 'cash')`, [id]);
    const { rows } = await tx.query<{ present: number; absent: number; ot_hours: string }>(`select present, absent, ot_hours from labour_month_days`);
    expect(rows).toEqual([{ present: 1, absent: 1, ot_hours: '2.00' }]);
    const { affectedRows } = await tx.query(`update labour_settings set pf_bp = 0`);
    expect(affectedRows).toBe(0);
    await expect(tx.query(`insert into labour_settings (from_month, pf_bp, pf_ceiling_paise, esic_bp, esic_limit_paise) values ('2026-11-01', 0, 0, 0, 0)`)).rejects.toThrow('row-level security');
  });
});

it('keeps supervisors out, and lets the office in and change the rates', async () => {
  await asUser(db, supervisor, async (tx) => {
    expect((await tx.query(`select * from labour_settings`)).rows).toEqual([]);
    await expect(addWorker(tx)).rejects.toThrow('row-level security');
  });
  await asUser(db, office, async (tx) => {
    await addWorker(tx);
    await tx.query(`insert into labour_settings (from_month, pf_bp, pf_ceiling_paise, esic_bp, esic_limit_paise) values ('2026-11-01', 1000, 1500000, 75, 2100000)`);
  });
});

it('refuses OT when absent or for staff, and a money line that makes no sense', async () => {
  await asUser(db, labour, async (tx) => {
    const worker = await addWorker(tx);
    const staff = await addWorker(tx, 'staff');
    await tx.exec('savepoint a');
    await expect(tx.query(`insert into labour_attendance (worker_id, work_date, present, ot_hours) values ($1, '2026-10-01', false, 1)`, [worker])).rejects.toThrow('check constraint');
    await tx.exec('rollback to savepoint a');
    await expect(tx.query(`insert into labour_attendance (worker_id, work_date, present, ot_hours) values ($1, '2026-10-01', true, 1)`, [staff])).rejects.toThrow('no OT');
    await tx.exec('rollback to savepoint a');
    await expect(tx.query(`insert into labour_money (worker_id, money_date, kind, amount_paise, method) values ($1, '2026-10-01', 'deduction', 100, null)`, [worker])).rejects.toThrow('check constraint');
    await tx.exec('rollback to savepoint a');
    await expect(tx.query(`insert into labour_money (worker_id, money_date, kind, amount_paise, method) values ($1, '2026-10-01', 'payment', 0, 'cash')`, [worker])).rejects.toThrow('check constraint');
  });
});

it('lets the one who typed a money line remove it that day; nobody can change one', async () => {
  const id = await asUser(db, labour, async (tx) => {
    const worker = await addWorker(tx);
    const { rows } = await tx.query<{ id: string }>(`insert into labour_money (worker_id, money_date, kind, amount_paise, method) values ($1, '2026-10-01', 'payment', 100, 'cash') returning id`, [worker]);
    return rows[0]!.id;
  });
  await asUser(db, labour, async (tx) => {
    await expect(tx.query(`update labour_money set amount_paise = 5`)).rejects.toThrow('permission denied');
  });
  await db.query(`update labour_money set created_at = now() - interval '2 days' where id = $1`, [id]);
  await asUser(db, labour, async (tx) => {
    expect((await tx.query(`delete from labour_money where id = $1`, [id])).affectedRows).toBe(0);
  });
  await asUser(db, office, async (tx) => {
    expect((await tx.query(`delete from labour_money where id = $1`, [id])).affectedRows).toBe(1);
  });
});
