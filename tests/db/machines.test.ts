import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { asUser, createMigratedDb, createUser, seedBasics } from './harness';

let template: PGlite;
let db: PGliteInterface;
let office: string;
let supervisor: string;
let labour: string;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  const seed = await seedBasics(db);
  office = await createUser(db, 'office', 'Office');
  supervisor = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  labour = await createUser(db, 'labour', 'Labour Clerk');
});

const addMachine = (tx: Pick<PGliteInterface, 'query'>) => tx.query<{ id: string; service_every_hours: number }>(
  `insert into machines (name, rented_to) values ('AJAX 1', 'Sharma Builders') returning id, service_every_hours`).then((r) => r.rows[0]!);

it('lets the office keep machines and their services, due every 500 hours unless told otherwise', async () => {
  await asUser(db, office, async (tx) => {
    const machine = await addMachine(tx);
    expect(machine.service_every_hours).toBe(500);
    const { rows } = await tx.query<{ id: string }>(
      `insert into machine_services (machine_id, service_date, running_hours, cost_paise) values ($1, '2026-10-01', 1500.5, 1250000) returning id`, [machine.id]);
    expect((await tx.query(`delete from machine_services where id = $1`, [rows[0]!.id])).affectedRows).toBe(1);
  });
});

it('keeps a service line from being changed: it is taken off and typed again', async () => {
  await asUser(db, office, async (tx) => {
    const machine = await addMachine(tx);
    await tx.query(`insert into machine_services (machine_id, service_date, running_hours, cost_paise) values ($1, '2026-10-01', 100, 100)`, [machine.id]);
    await expect(tx.query(`update machine_services set cost_paise = 5`)).rejects.toThrow('permission denied');
  });
});

it('keeps supervisors and Labour logins out', async () => {
  const machine = await asUser(db, office, addMachine);
  for (const user of [supervisor, labour]) {
    await asUser(db, user, async (tx) => {
      expect((await tx.query(`select * from machines`)).rows).toEqual([]);
      await expect(tx.query(`insert into machine_services (machine_id, service_date, running_hours, cost_paise) values ($1, '2026-10-01', 1, 1)`, [machine.id])).rejects.toThrow('row-level security');
    });
  }
});

it('refuses hours or a cost below zero', async () => {
  await asUser(db, office, async (tx) => {
    const machine = await addMachine(tx);
    await tx.exec('savepoint a');
    await expect(tx.query(`insert into machine_services (machine_id, service_date, running_hours, cost_paise) values ($1, '2026-10-01', -1, 0)`, [machine.id])).rejects.toThrow('check constraint');
    await tx.exec('rollback to savepoint a');
    await expect(tx.query(`insert into machine_services (machine_id, service_date, running_hours, cost_paise) values ($1, '2026-10-01', 0, -1)`, [machine.id])).rejects.toThrow('check constraint');
  });
});
