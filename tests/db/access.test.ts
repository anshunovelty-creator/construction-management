import type { PGlite, PGliteInterface, Transaction } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cashTransfer, ownerCapital, siteCashExpense } from '@/lib/ledger/posting/cash';
import { clientBill } from '@/lib/ledger/posting/client';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import type { EntryDraft } from '@/lib/ledger/types';
import { asUser, createMigratedDb, createUser, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let owner: string;
let office: string; // assigned to A B Infra only
let supervisor: string; // assigned to the SVG site, holds Ramesh's cash
let otherSite: string;

interface PostResult {
  id: string;
  serial: string;
  duplicate: boolean;
}

const post = async (tx: Transaction, draft: EntryDraft, reason?: string): Promise<PostResult> => {
  const { rows } = await tx.query<{ r: PostResult }>('select app_post_entry($1::jsonb, $2) as r', [
    JSON.stringify(draft),
    reason ?? null,
  ]);
  return rows[0]!.r;
};

const ids = async (tx: Transaction, sql: string): Promise<string[]> =>
  (await tx.query<{ id: string }>(sql)).rows.map((row) => row.id).sort();

const abBill = () =>
  vendorBill({
    firmId: seed.ab, vendorId: seed.ansari, siteId: seed.svgSite, billDate: '2026-10-22', billNo: 'B-1',
    items: [{ costHead: 'material', amountPaise: 100_000 }],
  });

const rameshSpend = (siteId = seed.svgSite) =>
  siteCashExpense({
    from: seed.rameshCash, siteId, costHead: 'labour', amountPaise: 50_000, expenseDate: '2026-10-22', narration: 'helpers',
  });

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  otherSite = (await db.query<{ id: string }>(`insert into sites (name) values ('Other Site') returning id`)).rows[0]!.id;
  owner = await createUser(db, 'owner', 'Owner');
  office = await createUser(db, 'office', 'Priya', { firms: [seed.ab] });
  supervisor = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
  await db.query('update money_accounts set holder_user_id = $1 where id = $2', [supervisor, seed.rameshCash.id]);
});

describe('API access', () => {
  it('turns on row level security for every table', async () => {
    const { rows } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows).toEqual([]);
  });

  it('gives signed-out visitors nothing', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('set local role anon');
        await tx.query('select * from firms');
      }),
    ).rejects.toThrow('permission denied for table firms');
  });

  it('blocks direct ledger writes and the unchecked posting functions', async () => {
    await expect(
      asUser(db, owner, (tx) =>
        tx.query(`insert into books_locks (locked_through, actor) values ('2026-10-01', $1)`, [owner]),
      ),
    ).rejects.toThrow('permission denied for table books_locks');
    await expect(
      asUser(db, owner, (tx) => tx.query('select post_entry($1::jsonb, $2::uuid)', [JSON.stringify(abBill()), owner])),
    ).rejects.toThrow('permission denied for function post_entry');
  });

  it('shuts out deactivated users', async () => {
    await db.query('update profiles set is_active = false where user_id = $1', [office]);
    expect(await asUser(db, office, (tx) => ids(tx, 'select id from firms'))).toEqual([]);
    await expect(asUser(db, office, (tx) => post(tx, abBill()))).rejects.toThrow('deactivated');
  });

  it('refuses an entry id already used by someone else', async () => {
    const draft = rameshSpend();
    await asUser(db, supervisor, (tx) => post(tx, draft));
    expect((await asUser(db, supervisor, (tx) => post(tx, draft))).duplicate).toBe(true);
    await expect(asUser(db, office, (tx) => post(tx, draft))).rejects.toThrow('already in use');
  });
});

describe('supervisor', () => {
  it('sees only assigned sites, their own cash and no work orders', async () => {
    await asUser(db, supervisor, async (tx) => {
      expect(await ids(tx, 'select id from sites')).toEqual([seed.svgSite]);
      expect(await ids(tx, 'select id from work_orders')).toEqual([]);
      expect(await ids(tx, 'select id from money_accounts')).toEqual([seed.rameshCash.id]);
    });
  });

  it('posts site spends only from their own cash, at their own sites', async () => {
    const posted = await asUser(db, supervisor, (tx) => post(tx, rameshSpend()));
    expect(posted.serial).toBe('CM/26-27/000001');
    await expect(asUser(db, supervisor, (tx) => post(tx, rameshSpend(otherSite)))).rejects.toThrow(
      'not assigned to this site',
    );
    const fromOwnerCash = { ...rameshSpend(), lines: rameshSpend().lines.map((l) =>
      l.account === 'money' ? { ...l, moneyAccountId: seed.ownerCash.id } : l) };
    await expect(asUser(db, supervisor, (tx) => post(tx, fromOwnerCash))).rejects.toThrow('their own cash');
    await expect(asUser(db, supervisor, (tx) => post(tx, abBill()))).rejects.toThrow('cannot post vendor_bill');
  });

  it('sees their own entries and cash given to them, never client income', async () => {
    const given = await asUser(db, owner, (tx) =>
      post(tx, cashTransfer({ from: seed.ownerCash, to: seed.rameshCash, amountPaise: 2_000_000, transferDate: '2026-10-22' })),
    );
    await asUser(db, owner, (tx) =>
      post(tx, clientBill({ workOrder: seed.workOrder, billDate: '2026-10-22', billNo: 'RA-1', grossPaise: 100_000, deductions: {} })),
    );
    const spent = await asUser(db, supervisor, (tx) => post(tx, rameshSpend()));
    await asUser(db, supervisor, async (tx) => {
      expect(await ids(tx, 'select id from entries')).toEqual([given.id, spent.id].sort());
      expect(await ids(tx, `select entry_id as id from entry_lines where account = 'contract_income'`)).toEqual([]);
      expect(await ids(tx, 'select entry_id as id from entry_status')).toEqual([given.id, spent.id].sort());
      // Balances add up only what the supervisor can see: owner cash out, their cash in, their own spend.
      const { rows } = await tx.query<{ account: string; amount_paise: number }>(
        'select account, amount_paise from balances order by account, amount_paise',
      );
      expect(rows).toEqual([
        { account: 'money', amount_paise: -2_000_000 },
        { account: 'money', amount_paise: 1_950_000 },
        { account: 'site_cost', amount_paise: 50_000 },
      ]);
    });
  });
});

describe('office staff', () => {
  it('work only within their assigned firms', async () => {
    await asUser(db, office, (tx) => post(tx, abBill()));
    await expect(asUser(db, office, (tx) => post(tx, { ...abBill(), firmId: seed.jayraj, lines: abBill().lines.map((l) => ({ ...l, firmId: seed.jayraj })) }))).rejects.toThrow(
      'not assigned to every firm',
    );
    const jayrajPaysAb = vendorPayment({
      billFirmId: seed.ab, vendorId: seed.ansari, from: seed.jayrajBank, amountPaise: 100, paymentDate: '2026-10-22', reference: 'U1',
    });
    await expect(asUser(db, office, (tx) => post(tx, jayrajPaysAb))).rejects.toThrow('not assigned to every firm');
    await asUser(db, office, async (tx) => {
      expect(await ids(tx, 'select id from work_orders')).toEqual([]); // the work order is Jayraj's
      expect(await ids(tx, 'select id from money_accounts')).toEqual(
        [seed.abBank.id, seed.ownerCash.id, seed.rameshCash.id].sort(),
      );
    });
  });

  it('cannot post owner-only entry types', async () => {
    await expect(
      asUser(db, office, (tx) => post(tx, ownerCapital({ account: seed.ownerCash, amountPaise: 100, date: '2026-10-22' }))),
    ).rejects.toThrow('office staff cannot post owner_capital');
  });

  it('verify entries made by others, and only the owner changes verified ones', async () => {
    const bill = await asUser(db, office, (tx) => post(tx, abBill()));
    await expect(asUser(db, office, (tx) => tx.query('select app_verify_entry($1)', [bill.id]))).rejects.toThrow(
      'cannot verify your own entry',
    );
    const spend = await asUser(db, supervisor, (tx) => post(tx, rameshSpend()));
    await asUser(db, office, (tx) => tx.query('select app_verify_entry($1)', [spend.id]));
    await expect(asUser(db, supervisor, (tx) => tx.query('select app_verify_entry($1)', [bill.id]))).rejects.toThrow(
      'supervisors cannot verify',
    );

    await asUser(db, owner, (tx) => tx.query('select app_verify_entry($1)', [bill.id]));
    await expect(
      asUser(db, office, (tx) => tx.query('select app_reverse_entry($1, $2)', [bill.id, 'wrong amount'])),
    ).rejects.toThrow('only the owner can change it');
    await asUser(db, owner, (tx) => tx.query('select app_reverse_entry($1, $2)', [bill.id, 'wrong amount']));
  });

  it('leave locked books to the owner', async () => {
    await expect(asUser(db, office, (tx) => tx.query(`select app_lock_books('2026-10-21')`))).rejects.toThrow(
      'only the owner can lock',
    );
    await asUser(db, owner, (tx) => tx.query(`select app_lock_books('2026-10-21')`));
    const late = { ...abBill(), entryDate: '2026-10-20' };
    await expect(asUser(db, office, (tx) => post(tx, late, 'bill found late'))).rejects.toThrow(
      'only the owner can post on or before',
    );
    await asUser(db, owner, (tx) => post(tx, late, 'bill found late'));
  });
});

describe('masters through the API', () => {
  it('lets office staff add vendors, but only the owner add firms', async () => {
    await asUser(db, office, (tx) => tx.query(`insert into parties (kind, name) values ('vendor', 'New Vendor')`));
    await expect(
      asUser(db, office, (tx) => tx.query(`insert into firms (code, name) values ('NF', 'New Firm')`)),
    ).rejects.toThrow('row-level security');
    await expect(
      asUser(db, supervisor, (tx) => tx.query(`insert into parties (kind, name) values ('vendor', 'Sneaky')`)),
    ).rejects.toThrow('row-level security');
  });

  it('lets users change their own language but nothing else on their profile', async () => {
    await asUser(db, supervisor, async (tx) => {
      await tx.query(`select app_set_my_language('hi')`);
      await tx.query(`update profiles set role = 'owner' where user_id = $1`, [supervisor]);
    });
    const { rows } = await db.query('select role, language from profiles where user_id = $1', [supervisor]);
    expect(rows).toEqual([{ role: 'supervisor', language: 'hi' }]);
  });
});
