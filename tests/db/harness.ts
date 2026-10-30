import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type PGliteInterface, type Transaction } from '@electric-sql/pglite';
import type { EntryDraft, MoneyAccountRef, ClientRef } from '@/lib/ledger/types';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');
const SUPABASE_STUB = join(import.meta.dirname, 'supabase-stub.sql');

/** A fresh in-process Postgres with Supabase's basics and every migration applied, in file-name order. */
export async function createMigratedDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(SUPABASE_STUB, 'utf8'));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

export const OWNER = '00000000-0000-4000-8000-000000000001';
export const OFFICE = '00000000-0000-4000-8000-000000000002';
export const SUPERVISOR = '00000000-0000-4000-8000-000000000003';

export interface Seed {
  jayraj: string;
  ab: string;
  svgSite: string;
  ansari: string;
  svgClient: string;
  workOrder: { id: string };
  client: ClientRef;
  jayrajBank: MoneyAccountRef;
  abBank: MoneyAccountRef;
  ownerCash: MoneyAccountRef;
  rameshCash: MoneyAccountRef;
}

async function insertId(db: PGliteInterface, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(sql, params);
  return rows[0]!.id;
}

/** Two firms, one site, one vendor, one client, one work order and four money accounts. */
export async function seedBasics(db: PGliteInterface): Promise<Seed> {
  const jayraj = await insertId(db, `insert into firms (code, name) values ('JI', 'Jayraj Infra') returning id`, []);
  const ab = await insertId(db, `insert into firms (code, name) values ('AB', 'A B Infra') returning id`, []);
  const svgSite = await insertId(db, `insert into sites (name) values ('SVG Site') returning id`, []);
  const ansari = await insertId(db, `insert into parties (kind, name) values ('vendor', 'Ansari Enterprise') returning id`, []);
  const svgClient = await insertId(db, `insert into parties (kind, name) values ('client', 'SVG Client') returning id`, []);
  const workOrderId = await insertId(
    db,
    `insert into work_orders (firm_id, client_id, site_id, ref, contract_type, tds_bp, retention_bp, start_date)
     values ($1, $2, $3, 'WO-SVG-1', 'item_rate', 100, 500, '2026-04-01') returning id`,
    [jayraj, svgClient, svgSite],
  );
  const account = async (kind: MoneyAccountRef['kind'], name: string, firmId: string | null): Promise<MoneyAccountRef> => ({
    id: await insertId(db, `insert into money_accounts (kind, name, firm_id) values ($1, $2, $3) returning id`, [kind, name, firmId]),
    kind,
    firmId,
  });
  return {
    jayraj,
    ab,
    svgSite,
    ansari,
    svgClient,
    workOrder: { id: workOrderId },
    client: { firmId: jayraj, clientId: svgClient, siteId: svgSite },
    jayrajBank: await account('bank', 'Jayraj Infra - Bank', jayraj),
    abBank: await account('bank', 'A B Infra - Bank', ab),
    ownerCash: await account('owner_cash', 'Owner cash', null),
    rameshCash: await account('supervisor_cash', 'Ramesh cash', null),
  };
}

/** Owner gives Ramesh cash: the simplest valid entry (common CM series). */
export function ownerToRamesh(seed: Seed, amountPaise: number, entryDate = '2026-10-22'): EntryDraft {
  return {
    id: crypto.randomUUID(),
    entryType: 'cash_transfer',
    entryDate,
    firmId: null,
    lines: [
      { account: 'money', amountPaise, moneyAccountId: seed.rameshCash.id },
      { account: 'money', amountPaise: -amountPaise, moneyAccountId: seed.ownerCash.id },
    ],
  };
}

/** Cash drawn from Jayraj's bank to the owner (JI series). */
export function jayrajBankToOwner(seed: Seed, amountPaise: number): EntryDraft {
  return {
    id: crypto.randomUUID(),
    entryType: 'cash_transfer',
    entryDate: '2026-10-22',
    firmId: seed.jayraj,
    reference: 'CHQ-1',
    lines: [
      { account: 'money', amountPaise, moneyAccountId: seed.ownerCash.id },
      { account: 'money', amountPaise: -amountPaise, firmId: seed.jayraj, moneyAccountId: seed.jayrajBank.id },
    ],
  };
}

/** Sum of lines for one account, filtered by the given column values. */
export async function balanceOf(
  db: PGliteInterface,
  account: string,
  filters: Record<string, string | null> = {},
): Promise<number> {
  const params: unknown[] = [account];
  const where = Object.entries(filters).map(([column, value]) => {
    if (value === null) return `${column} is null`;
    params.push(value);
    return `${column} = $${params.length}::uuid`;
  });
  const { rows } = await db.query<{ total: number }>(
    `select coalesce(sum(amount_paise), 0)::bigint as total from entry_lines
     where account = $1::ledger_account ${where.map((w) => `and ${w}`).join(' ')}`,
    params,
  );
  return rows[0]!.total;
}

export type AppRole = 'owner' | 'office' | 'supervisor';

/** An app user: a Supabase Auth login plus a profile with a role and assignments. */
export async function createUser(
  db: PGliteInterface,
  role: AppRole,
  name: string,
  assigned: { firms?: string[]; sites?: string[] } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const email = `${name.toLowerCase()}@example.test`;
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  await db.query('insert into profiles (user_id, email, full_name, role) values ($1, $2, $3, $4)', [id, email, name, role]);
  for (const firmId of assigned.firms ?? []) {
    await db.query('insert into user_firms (user_id, firm_id) values ($1, $2)', [id, firmId]);
  }
  for (const siteId of assigned.sites ?? []) {
    await db.query('insert into user_sites (user_id, site_id) values ($1, $2)', [id, siteId]);
  }
  return id;
}

/** Runs `fn` the way a Supabase API request from this user runs: role `authenticated`, the user's JWT claims. */
export async function asUser<T>(
  db: PGliteInterface,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await tx.exec('set local role authenticated');
    return fn(tx);
  });
}
