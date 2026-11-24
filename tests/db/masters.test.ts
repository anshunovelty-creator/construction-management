import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMigratedDb, seedBasics, type Seed } from './harness';

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

describe('masters', () => {
  it('rejects a firm code that clashes with the common series', async () => {
    await expect(db.query(`insert into firms (code, name) values ('CM', 'Common')`)).rejects.toThrow(
      'firms_code_check',
    );
  });

  it('requires every bank and cash account to belong to a firm', async () => {
    const add = (kind: string, name: string, firm: string | null) =>
      db.query('insert into money_accounts (kind, name, firm_id) values ($1, $2, $3)', [kind, name, firm]);
    for (const kind of ['bank', 'owner_cash', 'supervisor_cash']) {
      await expect(add(kind, `No firm ${kind}`, null)).rejects.toThrow('money_accounts_check');
      // Jayraj has its one cash already.
      if (kind !== 'owner_cash') await add(kind, `Firm ${kind}`, seed.jayraj);
    }
  });

  it('only allows a client party as the client of a work order', async () => {
    await expect(
      db.query(
        `insert into work_orders (firm_id, client_id, site_id, ref, contract_type, start_date)
         values ($1, $2, $3, 'WO-BAD', 'fixed', '2026-04-01')`,
        [seed.jayraj, seed.ansari, seed.svgSite],
      ),
    ).rejects.toThrow('is not a party of kind client');
  });

  it('lets the same vendor name exist once per kind', async () => {
    await expect(
      db.query(`insert into parties (kind, name) values ('vendor', 'Ansari Enterprise')`),
    ).rejects.toThrow('parties_kind_name_key');
  });
});
