import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { asUser, createMigratedDb, createUser, seedBasics, type Seed } from './harness';

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

it('lets a supervisor rent for their own site, then set only the return date and bill number', async () => {
  const other = (await db.query<{ id: string }>(`insert into sites (name) values ('Other Site') returning id`)).rows[0]!.id;
  const ramesh = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  const rent = (siteId: string) => asUser(db, ramesh, (tx) => tx.query<{ id: string }>(
    `insert into rentals (site_id, vendor_id, item, quantity, rate_paise, rented_on)
     values ($1, $2, 'Shuttering plate', 10, 75, '2026-11-02') returning id`, [siteId, seed.ansari]));

  const id = (await rent(seed.svgSite)).rows[0]!.id;
  await expect(rent(other)).rejects.toThrow('row-level security');

  await asUser(db, ramesh, (tx) => tx.query(`update rentals set returned_on = '2026-11-12', bill_no = 'R-7' where id = $1`, [id]));
  await expect(asUser(db, ramesh, (tx) => tx.query(`update rentals set rate_paise = 50 where id = $1`, [id])))
    .rejects.toThrow('permission denied');
  await expect(asUser(db, ramesh, (tx) => tx.query(`update rentals set returned_on = '2026-11-01' where id = $1`, [id])))
    .rejects.toThrow('check constraint'); // back before it came
  expect((await db.query(`select returned_on::text, bill_no from rentals`)).rows).toEqual([{ returned_on: '2026-11-12', bill_no: 'R-7' }]);
});
