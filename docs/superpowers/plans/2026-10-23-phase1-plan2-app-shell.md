# Phase 1 · Plan 2: App Shell, Users and Masters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Plan 1 ledger behind a real app: a Supabase project, email + password logins created by the owner, roles enforced by the database (row level security), English/Hindi screens for all master data with a change history, and the tools to import the opening balances from the two outstanding workbooks.

**Architecture:** Next.js (App Router) server components read Supabase *as the signed-in user*, so every query passes through row level security. All ledger writes go through new `app_*` Postgres functions that check the caller's role and assignments, then call the Plan 1 functions with `auth.uid()` as the actor; the Plan 1 functions themselves are no longer callable from the API. Forms are plain HTML forms posting to server actions, validated by one small parser (`parseFields`) driven by a field registry. The secret key is used only to create logins (owner-only server actions) and by the import scripts. Tests still run on PGlite: a small SQL file stands in for what every Supabase project already has (the `auth` schema and the API roles), so the real migrations and policies are tested in-process.

**Tech stack (exact versions):** Next.js 16.4.2, React 19.3.1, @supabase/supabase-js 2.118.0, @supabase/ssr 0.12.7, next-intl 4.14.9, Tailwind CSS 4.3.3, exceljs 4.4.0, tsx 4.23.15, Supabase CLI 2.121.0; plus Plan 1's TypeScript 7.0.2, Vitest 5.0.5, PGlite 0.5.11. Works on Node 22 (Node 24 not required).

**Spec:** `docs/superpowers/specs/2026-10-22-construction-ledger-design.md` (sections 4, 6 rule 11, 8 "Setup", 12, 14).

**Pre-validated:** every file in this plan was built and run before the plan was written: `next build` passes, `npm run typecheck` passes, `Test Files 17 passed (17)`, `Tests 101 passed (101)`, `npm audit` reports 0 vulnerabilities, and the built app served `/login` in English and Hindi.

---

## Where this plan fits

| Plan | Delivers |
|---|---|
| 1. Ledger core (done) | Schema, safety rules, posting rules for every Phase 1 form, tests |
| **2. App shell & masters (this plan)** | Next.js app, Supabase project, email + password login, roles and row level security, English/Hindi, master-data screens with change history (spec rule 11), opening-balance import |
| 3. Office forms | Vendor bill, pay vendor (with bill matching), client bill, receipt, transfers, owner capital/drawings, verify queue, period lock, duplicate warnings, vendor and bank statement checks |
| 4. Supervisor app | Installable PWA, offline queue with sync, site cash expense, cash received, day close |
| 5. Reports & dashboard | Day book, cash/bank book, vendor/client/site ledgers, Excel export, owner dashboard, backups, production deploy |

## Conventions (read before starting)

- Everything in Plan 1's conventions still holds (integer paise, sign convention, append-only ledger, inter-firm dues only when money crosses).
- **Who can do what lives in the database.** The app calls only the `app_*` functions and reads tables through row level security. Server-side role checks in the app (`requireProfile`) are for friendly redirects, not for security.
- **Every new table, now and in later plans:** `enable row level security`, add policies, and `grant` exactly what the API needs. Default privileges are revoked (fail closed), so a forgotten grant shows up as "permission denied", never as a data leak. A test fails if any table lacks row level security.
- **The secret key** (`SUPABASE_SECRET_KEY`) is used only in `src/lib/supabase/admin.ts`, which only owner-checked server actions and the scripts import. Never give it a `NEXT_PUBLIC_` prefix.
- **The GitHub repository is public.** Real business data (the outstanding workbooks, the review sheets, `.env.local`) lives only in git-ignored places: `data/private/` and `.env.local`. Check `git status` before every commit in Tasks 10 and 11.
- **Git:** work on branch `feat/app-shell`. Commit as yourself; the repo hooks reject any Claude/Anthropic author or `Co-Authored-By` line, and you must never pass `--no-verify`.
- Run every command from the repository root.

### Decisions recorded here (so later plans don't re-litigate them)

1. **Login is email + password** (owner decision, 2026-10-23), replacing the spec's "mobile number + password". The owner creates every account; self sign-up is switched off in Supabase. Users never need an SMS provider.
2. **Forms:** native HTML forms + server actions + one parser (`src/lib/masters/parse.ts`) instead of React Hook Form + Zod + shadcn/ui. The master screens don't need client-side form state. Revisit in Plan 3/4 if the money forms do.
3. **One config-driven master screen** (`src/lib/masters/registry.ts`) serves firms, sites, parties, work orders and money accounts. Users get their own screens (they need the auth admin API).
4. **No language in the URL.** The user's language is stored on their profile and copied into a `locale` cookie at sign-in and when changed in Settings.
5. **Visibility:** office staff see entries of their assigned firms plus common (firm-less) entries; supervisors see only entries they made or that touch their own cash, never work orders (client rates) or client income. Office staff may add and edit parties; every other master is owner-only.
6. **Only the owner** posts into locked books, cancels or replaces verified entries, cancels entries in locked books, locks the books, and posts opening, owner capital and owner drawing entries. Office staff post vendor bills/payments, client bills/receipts and cash transfers for their firms. Supervisors post site cash expenses and day-close differences from their own cash at their own sites.
7. **Opening balances** are imported once, through a review sheet the owner edits (clean vendor names, add bank/cash/client rows). Each row gets a fixed entry id, so re-running the import never posts twice. To correct an imported amount later, cancel that entry in the app (Plan 3) and post a correction; don't re-import.
8. **No local Supabase (Docker).** The real database is the cloud project (Mumbai); tests use PGlite with `tests/db/supabase-stub.sql`.
9. **Playwright** end-to-end tests start in Plan 3, with the first money flows.

## File structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `.env.example` | Tooling and settings |
| `tests/db/supabase-stub.sql` | Test-only stand-in for Supabase's `auth` schema and API roles |
| `tests/db/harness.ts` (modify) | Applies the stub first; `createUser`, `asUser` helpers |
| `supabase/migrations/20261023120000_users.sql` | Roles, profiles, firm/site assignments, `app_my_role` and friends |
| `supabase/migrations/20261023120100_master_audit.sql` | `master_changes` log and triggers (spec rule 11) |
| `supabase/migrations/20261023120200_app_functions.sql` | `app_post_entry`, `app_verify_entry`, `app_reject_entry`, `app_reverse_entry`, `app_replace_entry`, `app_lock_books` with permission checks |
| `supabase/migrations/20261023120300_row_level_security.sql` | Revokes, grants and policies for every table |
| `src/lib/masters/registry.ts` | Field definitions for every form |
| `src/lib/masters/parse.ts` | Form data → column values or field errors |
| `src/lib/masters/diff.ts` | Which fields a logged change touched |
| `messages/en.json`, `messages/hi.json` | All screen text |
| `src/i18n/locale.ts`, `src/i18n/request.ts` | Language from the `locale` cookie |
| `src/lib/supabase/{env,server,admin}.ts`, `src/proxy.ts`, `src/lib/auth.ts` | Supabase clients, session refresh, sign-in checks |
| `src/components/form.tsx` | The one form component |
| `src/app/layout.tsx`, `src/app/globals.css`, `src/app/login/*` | Root layout, styles, sign-in |
| `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/settings/*` | Signed-in shell, home, language setting |
| `src/app/(app)/masters/*` | Master lists, add and edit |
| `src/app/(app)/users/*` | Owner creates and edits users |
| `src/app/(app)/history/page.tsx` | Change history |
| `src/lib/openings/openings.ts` | Opening-balance extraction, review sheet, totals check, entry drafts |
| `scripts/{dump-workbook,openings-extract,openings-import,create-owner}.ts` | Command-line tools |
| `tests/db/{master-audit,access}.test.ts`, `tests/masters/*.test.ts`, `tests/i18n.test.ts`, `tests/openings/openings.test.ts` | Tests |

---

### Task 1: Dependencies and settings

**Files:**
- Modify: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `next.config.ts`, `postcss.config.mjs`, `.env.example`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main && git pull
git checkout -b feat/app-shell
```

- [ ] **Step 2: Install the app's packages at exact versions**

```bash
npm install --save-exact next@16.4.2 react@19.3.1 react-dom@19.3.1 @supabase/supabase-js@2.118.0 @supabase/ssr@0.12.7 next-intl@4.14.9
npm install --save-exact -D @types/react@19.3.0 @types/react-dom@19.3.0 tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 exceljs@4.4.0 tsx@4.23.15 supabase@2.121.0
```

- [ ] **Step 3: Replace exceljs's vulnerable `uuid` and add the scripts**

exceljs 4.4.0 pulls in `uuid` 8.3.2, which has a moderate advisory (GHSA-w5hq-g745-h8pq). Version 11.1.1 has the fix and the same `v4()` that exceljs uses.

```bash
npm pkg set overrides.uuid=11.1.1
npm pkg set scripts.dev="next dev" scripts.build="next build" scripts.start="next start" \
  scripts.openings:dump="tsx scripts/dump-workbook.ts" \
  scripts.openings:extract="tsx scripts/openings-extract.ts" \
  scripts.openings:import="tsx --env-file=.env.local scripts/openings-import.ts" \
  scripts.create-owner="tsx --env-file=.env.local scripts/create-owner.ts" \
  scripts.db:push="supabase db push"
npm install
```

Expected: `found 0 vulnerabilities`. `package.json` should now be:

```json
{
  "name": "construction-ledger",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "openings:dump": "tsx scripts/dump-workbook.ts",
    "openings:extract": "tsx scripts/openings-extract.ts",
    "openings:import": "tsx --env-file=.env.local scripts/openings-import.ts",
    "create-owner": "tsx --env-file=.env.local scripts/create-owner.ts",
    "db:push": "supabase db push"
  },
  "devDependencies": {
    "@electric-sql/pglite": "0.5.11",
    "@tailwindcss/postcss": "4.3.3",
    "@types/node": "26.6.5",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "exceljs": "4.4.0",
    "supabase": "2.121.0",
    "tailwindcss": "4.3.3",
    "tsx": "4.23.15",
    "typescript": "7.0.2",
    "vitest": "5.0.5"
  },
  "dependencies": {
    "@supabase/ssr": "0.12.7",
    "@supabase/supabase-js": "2.118.0",
    "next": "16.4.2",
    "next-intl": "4.14.9",
    "react": "19.3.1",
    "react-dom": "19.3.1"
  },
  "overrides": {
    "uuid": "11.1.1"
  }
}
```

- [ ] **Step 4: Replace `tsconfig.json`**

This is the file Next.js would otherwise rewrite on its first build (JSX, its plugin, its generated route types).

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": [
      "es2022",
      "dom"
    ],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "types": [
      "node"
    ],
    "paths": {
      "@/*": [
        "./src/*"
      ]
    },
    "allowJs": true,
    "incremental": true,
    "resolveJsonModule": true,
    "jsx": "react-jsx",
    "plugins": [
      {
        "name": "next"
      }
    ]
  },
  "include": [
    "src",
    "tests",
    "scripts",
    "vitest.config.ts",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": [
    "node_modules"
  ]
}
```

- [ ] **Step 5: Create `next.config.ts` and `postcss.config.mjs`**

```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {};

// Uses src/i18n/request.ts.
export default createNextIntlPlugin()(nextConfig);
```

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
```

- [ ] **Step 6: Ignore build output, secrets and private data**

Append to `.gitignore`:

```
.next/
next-env.d.ts
*.tsbuildinfo
.env*.local
.env
data/private/
```

- [ ] **Step 7: Create `.env.example`**

```bash
# Copy to .env.local and fill in from Supabase: Project Settings → API Keys.
# .env.local is git-ignored. Never commit real keys: this repository is public.
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
# Secret key: used only on the server and by the import scripts. Never prefix it with NEXT_PUBLIC_.
SUPABASE_SECRET_KEY=sb_secret_xxx
```

- [ ] **Step 8: Check nothing broke**

Run: `npm test && npm run typecheck`
Expected: `Tests  61 passed (61)` and no type errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs .gitignore .env.example
git commit -m "chore: add Next.js, Supabase, next-intl, Tailwind and import tooling"
```

---

### Task 2: Supabase stand-in for tests

**Files:**
- Create: `tests/db/supabase-stub.sql`
- Modify: `tests/db/harness.ts`

The migrations from here on refer to `auth.users`, `auth.uid()` and the API roles `anon`, `authenticated` and `service_role`. Every Supabase project has these; plain PGlite doesn't. The stub creates them, including Supabase's habit of granting everything in `public` to the API roles, so tests see the same starting point as production.

- [ ] **Step 1: Create `tests/db/supabase-stub.sql`**

```sql
-- Test-only stand-in for what every Supabase project already has, so the migrations
-- run unchanged on plain PGlite. Never put this file in supabase/migrations.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

-- Same definition as Supabase: the signed-in user's id from the request's JWT claims.
create function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

-- Supabase grants everything in public to the API roles by default; row level security is the gate.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
```

- [ ] **Step 2: Apply the stub before the migrations in `tests/db/harness.ts`**

Replace the imports and `createMigratedDb` at the top of the file with:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type PGliteInterface, type Transaction } from '@electric-sql/pglite';
import type { EntryDraft, MoneyAccountRef, WorkOrderRef } from '@/lib/ledger/types';

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
```

- [ ] **Step 3: Add the user helpers to the end of `tests/db/harness.ts`**

```ts
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
```

(`createUser` and `asUser` are used from Task 3 on.)

- [ ] **Step 4: Run the database tests**

Run: `npx vitest run tests/db`
Expected: `Tests  28 passed (28)`. Plan 1's migrations run unchanged on top of the stub.

- [ ] **Step 5: Commit**

```bash
git add tests/db/supabase-stub.sql tests/db/harness.ts
git commit -m "test: stand in for Supabase auth and API roles on PGlite"
```

---

### Task 3: Users, roles and the change history

**Files:**
- Create: `supabase/migrations/20261023120000_users.sql`, `supabase/migrations/20261023120100_master_audit.sql`
- Test: `tests/db/master-audit.test.ts`

- [ ] **Step 1: Write the failing test `tests/db/master-audit.test.ts`**

```ts
import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asUser, createMigratedDb, createUser, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let owner: string;
let office: string;

interface Change {
  action: string;
  row_key: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_by: string | null;
}

const changes = async (table: string, action: string): Promise<Change[]> =>
  (
    await db.query<Change>(
      'select action, row_key, old_row, new_row, changed_by from master_changes where table_name = $1 and action = $2 order by id',
      [table, action],
    )
  ).rows;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  owner = await createUser(db, 'owner', 'Owner');
  office = await createUser(db, 'office', 'Priya', { firms: [seed.ab] });
});

describe('master data change history', () => {
  it('records who changed a vendor, with the old and new values', async () => {
    await asUser(db, owner, (tx) => tx.query(`update parties set phone = '9876543210' where id = $1`, [seed.ansari]));
    const [change] = await changes('parties', 'update');
    expect(change).toMatchObject({ row_key: seed.ansari, changed_by: owner });
    expect(change!.old_row).toMatchObject({ name: 'Ansari Enterprise', phone: '' });
    expect(change!.new_row).toMatchObject({ name: 'Ansari Enterprise', phone: '9876543210' });
  });

  it('skips updates that change nothing', async () => {
    await asUser(db, owner, (tx) => tx.query('update parties set phone = phone where id = $1', [seed.ansari]));
    expect(await changes('parties', 'update')).toEqual([]);
  });

  it('records assignments being removed', async () => {
    await asUser(db, owner, (tx) => tx.query('delete from user_firms where user_id = $1', [office]));
    const [change] = await changes('user_firms', 'delete');
    expect(change).toMatchObject({ row_key: office, changed_by: owner, new_row: null });
    expect(change!.old_row).toMatchObject({ firm_id: seed.ab });
  });

  it('marks changes made with the service key (scripts) as made by no user', async () => {
    const created = await changes('firms', 'insert');
    expect(created.map((c) => c.changed_by)).toEqual([null, null]);
  });

  it('keeps the history append-only and visible only to the owner', async () => {
    await expect(db.query(`update master_changes set action = 'insert'`)).rejects.toThrow('append-only');
    await expect(db.query('delete from master_changes')).rejects.toThrow('append-only');
    const count = 'select count(*)::int as n from master_changes';
    expect((await asUser(db, office, (tx) => tx.query<{ n: number }>(count))).rows[0]!.n).toBe(0);
    expect((await asUser(db, owner, (tx) => tx.query<{ n: number }>(count))).rows[0]!.n).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/db/master-audit.test.ts`
Expected: `Tests  5 failed (5)` with `relation "profiles" does not exist`.

- [ ] **Step 3: Create `supabase/migrations/20261023120000_users.sql`**

The `app_*` helper functions are `security definer` so that policies can call them without tripping over row level security on `profiles` themselves.

```sql
-- App users. Logins live in Supabase Auth (email + password, created by the owner);
-- profiles hold the role, language and assignments.

create type app_role as enum ('owner', 'office', 'supervisor');
create type app_language as enum ('en', 'hi');

create table profiles (
  user_id uuid primary key references auth.users (id),
  email text not null unique check (btrim(email) <> ''),
  full_name text not null check (btrim(full_name) <> ''),
  role app_role not null,
  language app_language not null default 'en',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Office staff work for assigned firms; supervisors work at assigned sites. The owner sees everything.
create table user_firms (
  user_id uuid not null references profiles (user_id),
  firm_id uuid not null references firms (id),
  primary key (user_id, firm_id)
);

create table user_sites (
  user_id uuid not null references profiles (user_id),
  site_id uuid not null references sites (id),
  primary key (user_id, site_id)
);

alter table money_accounts
  add constraint money_accounts_holder_fk foreign key (holder_user_id) references profiles (user_id);

-- Role of the signed-in user; null when signed out or deactivated.
create function app_my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where user_id = auth.uid() and is_active
$$;

create function app_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_my_role() = 'owner', false)
$$;

-- Owner: every firm. Office: assigned firms. Supervisor: none.
create function app_has_firm(p_firm_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case app_my_role()
    when 'owner' then true
    when 'office' then exists (select 1 from user_firms where user_id = auth.uid() and firm_id = p_firm_id)
    else false
  end
$$;

-- Owner and office: every site. Supervisor: assigned sites.
create function app_has_site(p_site_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case app_my_role()
    when 'owner' then true
    when 'office' then true
    when 'supervisor' then exists (select 1 from user_sites where user_id = auth.uid() and site_id = p_site_id)
    else false
  end
$$;

-- Users choose their own language; everything else on a profile is changed by the owner.
create function app_set_my_language(p_language app_language) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set language = p_language where user_id = auth.uid() and is_active;
  if not found then
    raise exception 'not signed in, or this account is deactivated';
  end if;
end $$;
```

- [ ] **Step 4: Create `supabase/migrations/20261023120100_master_audit.sql`**

```sql
-- Spec rule 11: every change to master data and users is logged with old value, new value, who and when.

create table master_changes (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_key text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_row jsonb,
  new_row jsonb,
  -- null = a script running with the service key (e.g. the opening-balance import)
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index master_changes_row on master_changes (table_name, row_key);

create trigger master_changes_append_only before update or delete on master_changes
  for each row execute function reject_change();
create trigger master_changes_no_truncate before truncate on master_changes
  for each statement execute function reject_change();

-- tg_argv[0] names the column that identifies the row.
create function log_master_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  insert into master_changes (table_name, row_key, action, old_row, new_row, changed_by)
  values (tg_table_name, coalesce(v_new, v_old) ->> tg_argv[0], lower(tg_op), v_old, v_new, auth.uid());
  return coalesce(new, old);
end $$;

create trigger firms_audit after insert or update or delete on firms
  for each row execute function log_master_change('id');
create trigger sites_audit after insert or update or delete on sites
  for each row execute function log_master_change('id');
create trigger parties_audit after insert or update or delete on parties
  for each row execute function log_master_change('id');
create trigger work_orders_audit after insert or update or delete on work_orders
  for each row execute function log_master_change('id');
create trigger money_accounts_audit after insert or update or delete on money_accounts
  for each row execute function log_master_change('id');
create trigger profiles_audit after insert or update or delete on profiles
  for each row execute function log_master_change('user_id');
create trigger user_firms_audit after insert or update or delete on user_firms
  for each row execute function log_master_change('user_id');
create trigger user_sites_audit after insert or update or delete on user_sites
  for each row execute function log_master_change('user_id');
```

- [ ] **Step 5: Run it**

Run: `npx vitest run tests/db/master-audit.test.ts`
Expected: `Tests  1 failed | 4 passed (5)`. The failing one is "keeps the history append-only and visible only to the owner": office staff can still read the log because row level security arrives in Task 4.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261023120000_users.sql supabase/migrations/20261023120100_master_audit.sql tests/db/master-audit.test.ts
git commit -m "feat: add users, roles, assignments and master-data change history"
```

---

### Task 4: Permission-checked ledger functions and row level security

**Files:**
- Create: `supabase/migrations/20261023120200_app_functions.sql`, `supabase/migrations/20261023120300_row_level_security.sql`
- Test: `tests/db/access.test.ts`

- [ ] **Step 1: Write the failing test `tests/db/access.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/db/access.test.ts`
Expected: `Tests  14 failed (14)`.

- [ ] **Step 3: Create `supabase/migrations/20261023120200_app_functions.sql`**

```sql
-- What the app calls. Each function checks the signed-in user's role and assignments,
-- then calls the Plan 1 ledger function with auth.uid() as the actor.

-- Office: entries of their firms, and common (firm-less) entries. Supervisor: entries they made
-- and entries that touch their own cash. Supervisors never see client income or other sites' costs.
create function app_can_see_entry(p_entry_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case app_my_role()
    when 'owner' then true
    when 'office' then exists (
      select 1 from entries e
      where e.id = p_entry_id
        and (
          e.firm_id is null
          or app_has_firm(e.firm_id)
          or exists (
            select 1 from entry_lines l
            where l.entry_id = e.id and (app_has_firm(l.firm_id) or app_has_firm(l.counter_firm_id))
          )
        )
    )
    when 'supervisor' then exists (
      select 1 from entries e
      where e.id = p_entry_id
        and (
          e.created_by = auth.uid()
          or exists (
            select 1 from entry_lines l
            join money_accounts m on m.id = l.money_account_id
            where l.entry_id = e.id and m.holder_user_id = auth.uid()
          )
        )
    )
    else false
  end
$$;

create function app_assert_signed_in() returns app_role
language plpgsql stable security definer set search_path = public as $$
declare
  v_role app_role := app_my_role();
begin
  if v_role is null then
    raise exception 'not signed in, or this account is deactivated';
  end if;
  return v_role;
end $$;

create function app_assert_can_post(p_entry jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_role app_role := app_assert_signed_in();
  v_type text := p_entry ->> 'entryType';
  v_lock date := current_lock_date();
  v_line jsonb;
begin
  if v_role = 'owner' then
    return;
  end if;
  if v_lock is not null and (p_entry ->> 'entryDate')::date <= v_lock then
    raise exception 'books are locked through %; only the owner can post on or before that date', v_lock;
  end if;

  if v_role = 'office' then
    if v_type not in ('vendor_bill', 'vendor_payment', 'client_bill', 'client_receipt', 'cash_transfer') then
      raise exception 'office staff cannot post % entries', v_type;
    end if;
    if nullif(p_entry ->> 'firmId', '') is not null and not app_has_firm((p_entry ->> 'firmId')::uuid) then
      raise exception 'you are not assigned to every firm in this entry';
    end if;
    for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
      if (nullif(v_line ->> 'firmId', '') is not null and not app_has_firm((v_line ->> 'firmId')::uuid))
         or (nullif(v_line ->> 'counterFirmId', '') is not null
             and not app_has_firm((v_line ->> 'counterFirmId')::uuid)) then
        raise exception 'you are not assigned to every firm in this entry';
      end if;
    end loop;
    return;
  end if;

  -- Supervisor: only site spends and day-close differences, only from their own cash, only at their sites.
  if v_type not in ('site_cash_expense', 'cash_close_difference') then
    raise exception 'supervisors cannot post % entries', v_type;
  end if;
  for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
    if v_line ->> 'account' not in ('money', 'site_cost', 'cash_short_excess')
       or nullif(v_line ->> 'firmId', '') is not null then
      raise exception 'supervisor entries can only use your cash and site costs';
    end if;
    if v_line ->> 'account' = 'money' and not exists (
      select 1 from money_accounts
      where id = nullif(v_line ->> 'moneyAccountId', '')::uuid
        and kind = 'supervisor_cash' and holder_user_id = auth.uid()
    ) then
      raise exception 'supervisors can only spend from their own cash';
    end if;
    if nullif(v_line ->> 'siteId', '') is not null and not app_has_site((v_line ->> 'siteId')::uuid) then
      raise exception 'you are not assigned to this site';
    end if;
  end loop;
end $$;

-- Only the owner changes verified entries or entries in locked books (spec section 4, rule 6).
-- Others may cancel unverified entries they made, and office staff those of their firms.
create function app_assert_can_cancel(p_entry_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_role app_role := app_assert_signed_in();
  v_entry entries%rowtype;
  v_lock date := current_lock_date();
begin
  select * into v_entry from entries where id = p_entry_id;
  if not found or not app_can_see_entry(p_entry_id) then
    raise exception 'entry % not found', p_entry_id;
  end if;
  if v_role = 'owner' then
    return;
  end if;
  if exists (select 1 from entry_events where entry_id = p_entry_id and kind = 'verified') then
    raise exception 'entry % is verified; only the owner can change it', v_entry.serial;
  end if;
  if v_lock is not null and v_entry.entry_date <= v_lock then
    raise exception 'entry % is in locked books; only the owner can change it', v_entry.serial;
  end if;
  if v_entry.created_by <> auth.uid() and v_role <> 'office' then
    raise exception 'you cannot change entry %', v_entry.serial;
  end if;
end $$;

create function app_assert_can_review(p_entry_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_role app_role := app_assert_signed_in();
begin
  if v_role = 'supervisor' then
    raise exception 'supervisors cannot verify or reject entries';
  end if;
  if not app_can_see_entry(p_entry_id) then
    raise exception 'entry % not found', p_entry_id;
  end if;
end $$;

-- Re-sending an entry the same user already posted returns it unchanged (offline retries),
-- even if the books were locked in between.
create function app_post_entry(p_entry jsonb, p_override_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing entries%rowtype;
begin
  perform app_assert_signed_in();
  select * into v_existing from entries where id = (p_entry ->> 'id')::uuid;
  if found then
    if v_existing.created_by <> auth.uid() then
      raise exception 'entry id % is already in use', v_existing.id;
    end if;
    return jsonb_build_object('id', v_existing.id, 'serial', v_existing.serial, 'duplicate', true);
  end if;
  perform app_assert_can_post(p_entry);
  return post_entry(p_entry, auth.uid(), p_override_reason);
end $$;

create function app_verify_entry(p_entry_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app_assert_can_review(p_entry_id);
  perform verify_entry(p_entry_id, auth.uid());
end $$;

create function app_reject_entry(p_entry_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform app_assert_can_review(p_entry_id);
  return reject_entry(p_entry_id, auth.uid(), p_reason);
end $$;

create function app_reverse_entry(p_entry_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform app_assert_can_cancel(p_entry_id);
  return reverse_entry(p_entry_id, auth.uid(), p_reason);
end $$;

create function app_replace_entry(p_old_id uuid, p_new jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform app_assert_can_cancel(p_old_id);
  perform app_assert_can_post(p_new);
  return replace_entry(p_old_id, p_new, auth.uid(), p_reason);
end $$;

create function app_lock_books(p_through date, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_owner() then
    raise exception 'only the owner can lock the books';
  end if;
  perform lock_books(p_through, auth.uid(), p_reason);
end $$;
```

- [ ] **Step 4: Create `supabase/migrations/20261023120300_row_level_security.sql`**

```sql
-- Who can read and write what through the Supabase API. Keep this migration last:
-- it revokes everything first, then grants back only what the app needs.

-- Fail closed: tables and functions created later are unreachable from the API until granted on purpose.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- The secret key (scripts, creating logins) acts as service_role. Granted explicitly rather than
-- relying on project defaults, which have changed between Supabase versions.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter table firms enable row level security;
alter table sites enable row level security;
alter table parties enable row level security;
alter table work_orders enable row level security;
alter table money_accounts enable row level security;
alter table profiles enable row level security;
alter table user_firms enable row level security;
alter table user_sites enable row level security;
alter table entries enable row level security;
alter table entry_lines enable row level security;
alter table entry_events enable row level security;
alter table books_locks enable row level security;
alter table serial_counters enable row level security;
alter table master_changes enable row level security;

-- Masters. The owner manages them; office staff may also add and edit parties (vendors).
create policy firms_read on firms for select to authenticated using (app_my_role() is not null);
create policy firms_owner on firms for all to authenticated using (app_is_owner()) with check (app_is_owner());

create policy sites_read on sites for select to authenticated using (app_has_site(id));
create policy sites_owner on sites for all to authenticated using (app_is_owner()) with check (app_is_owner());

create policy parties_read on parties for select to authenticated using (app_my_role() is not null);
create policy parties_write on parties for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));

-- Work orders hold client rates and terms: never visible to supervisors.
create policy work_orders_read on work_orders for select to authenticated using (app_has_firm(firm_id));
create policy work_orders_owner on work_orders for all to authenticated
  using (app_is_owner()) with check (app_is_owner());

create policy money_accounts_read on money_accounts for select to authenticated using (
  app_is_owner()
  or (app_my_role() = 'office' and (firm_id is null or app_has_firm(firm_id)))
  or (app_my_role() is not null and holder_user_id = auth.uid())
);
create policy money_accounts_owner on money_accounts for all to authenticated
  using (app_is_owner()) with check (app_is_owner());

create policy profiles_read on profiles for select to authenticated using (app_my_role() is not null);
create policy profiles_owner on profiles for all to authenticated using (app_is_owner()) with check (app_is_owner());

create policy user_firms_read on user_firms for select to authenticated
  using (user_id = auth.uid() or app_is_owner());
create policy user_firms_owner on user_firms for all to authenticated
  using (app_is_owner()) with check (app_is_owner());

create policy user_sites_read on user_sites for select to authenticated
  using (user_id = auth.uid() or app_is_owner());
create policy user_sites_owner on user_sites for all to authenticated
  using (app_is_owner()) with check (app_is_owner());

-- Ledger: read-only through the API. Writes go only through the app_* functions.
-- ponytail: per-row function calls; rewrite as join-based policies if the day book gets slow.
create policy entries_read on entries for select to authenticated using (app_can_see_entry(id));
create policy entry_lines_read on entry_lines for select to authenticated using (app_can_see_entry(entry_id));
create policy entry_events_read on entry_events for select to authenticated using (app_can_see_entry(entry_id));
create policy books_locks_read on books_locks for select to authenticated using (app_my_role() is not null);
create policy master_changes_read on master_changes for select to authenticated using (app_is_owner());

-- Views run with their owner's rights unless told otherwise, which would skip the policies above.
alter view entry_status set (security_invoker = true);

grant select on firms, sites, parties, work_orders, money_accounts, profiles, user_firms, user_sites,
  entries, entry_lines, entry_events, books_locks, master_changes, entry_status to authenticated;
grant insert, update on firms, sites, parties, work_orders, money_accounts, profiles to authenticated;
grant insert, delete on user_firms, user_sites to authenticated;

grant execute on function
  app_my_role(), app_is_owner(), app_has_firm(uuid), app_has_site(uuid), app_can_see_entry(uuid),
  app_set_my_language(app_language), app_post_entry(jsonb, text), app_verify_entry(uuid),
  app_reject_entry(uuid, text), app_reverse_entry(uuid, text), app_replace_entry(uuid, jsonb, text),
  app_lock_books(date, text)
to authenticated;
```

- [ ] **Step 5: Run every database test**

Run: `npx vitest run tests/db`
Expected: `Test Files  7 passed (7)`, `Tests  47 passed (47)`.

- [ ] **Step 6: Prove the tests guard the policies**

In `20261023120300_row_level_security.sql`, temporarily change `work_orders_read ... using (app_has_firm(firm_id));` to `using (true);` and delete the `alter view entry_status set (security_invoker = true);` line. Run `npx vitest run tests/db/access.test.ts`.
Expected: `Tests  3 failed | 11 passed (14)` (supervisor and office visibility tests). Restore both lines (`git diff` must show only your new files) and run again: `Tests  14 passed (14)`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261023120200_app_functions.sql supabase/migrations/20261023120300_row_level_security.sql tests/db/access.test.ts
git commit -m "feat: enforce roles with permission-checked ledger functions and row level security"
```

---

### Task 5: Field registry and form parsing

**Files:**
- Create: `src/lib/masters/registry.ts`, `src/lib/masters/parse.ts`, `src/lib/masters/diff.ts`
- Test: `tests/masters/parse.test.ts`, `tests/masters/diff.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/masters/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseFields, percentToBasisPoints, submittedValues, toFormValue } from '@/lib/masters/parse';
import { EDIT_USER_FIELDS, MASTERS, NEW_USER_FIELDS } from '@/lib/masters/registry';

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};

const FIRM = '0b6c1f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const CLIENT = '1b6c1f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const SITE = '2b6c1f9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

describe('percentToBasisPoints', () => {
  it('converts percentages to basis points', () => {
    expect(percentToBasisPoints('1')).toBe(100);
    expect(percentToBasisPoints('0.5')).toBe(50);
    expect(percentToBasisPoints('12.25 %')).toBe(1225);
    expect(percentToBasisPoints('100')).toBe(10_000);
  });

  it('rejects anything else', () => {
    expect(() => percentToBasisPoints('101')).toThrow('more than 100%');
    expect(() => percentToBasisPoints('1.234')).toThrow('not a valid percentage');
    expect(() => percentToBasisPoints('-1')).toThrow('not a valid percentage');
  });
});

describe('parseFields', () => {
  const workOrder = MASTERS['work-orders']!.fields;

  it('turns a work-order form into column values', () => {
    const result = parseFields(
      workOrder,
      form([
        ['firm_id', FIRM], ['client_id', CLIENT], ['site_id', SITE], ['ref', ' WO-SVG-1 '],
        ['contract_type', 'item_rate'], ['contract_value_paise', '61,99,578'], ['tds_bp', '1'],
        ['retention_bp', '5'], ['security_deposit_bp', ''], ['start_date', '2026-04-01'], ['is_active', 'on'],
      ]),
    );
    expect(result).toEqual({
      ok: true,
      values: {
        firm_id: FIRM, client_id: CLIENT, site_id: SITE, ref: 'WO-SVG-1', contract_type: 'item_rate',
        contract_value_paise: 619_957_800, tds_bp: 100, retention_bp: 500, security_deposit_bp: 0,
        start_date: '2026-04-01', is_active: true,
      },
    });
  });

  it('reports every bad field at once', () => {
    const result = parseFields(
      workOrder,
      form([
        ['firm_id', 'not-an-id'], ['ref', ''], ['contract_type', 'lump_sum'], ['contract_value_paise', '12.345'],
        ['tds_bp', '150'], ['start_date', '2026-02-30'],
      ]),
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        firm_id: 'invalid_choice', client_id: 'required', site_id: 'required', ref: 'required',
        contract_type: 'invalid_choice', contract_value_paise: 'invalid_amount', tds_bp: 'invalid_percent',
        start_date: 'invalid_date',
      },
    });
  });

  it('handles user forms: email, password, assignments', () => {
    const created = parseFields(
      NEW_USER_FIELDS,
      form([
        ['email', ' Priya@Example.com '], ['password', 'secret pass'], ['full_name', 'Priya'], ['role', 'office'],
        ['language', 'hi'], ['firms', FIRM], ['firms', SITE],
      ]),
    );
    expect(created).toEqual({
      ok: true,
      values: {
        email: 'priya@example.com', password: 'secret pass', full_name: 'Priya', role: 'office', language: 'hi',
        firms: [FIRM, SITE], sites: [],
      },
    });
    expect(parseFields(NEW_USER_FIELDS, form([['email', 'nope'], ['password', 'short']]))).toMatchObject({
      ok: false,
      errors: { email: 'invalid_email', password: 'password_short' },
    });
  });

  it('keeps the current password when the edit form leaves it empty', () => {
    const result = parseFields(
      EDIT_USER_FIELDS,
      form([['full_name', 'Priya'], ['role', 'office'], ['language', 'en'], ['password', '']]),
    );
    expect(result.ok && 'password' in result.values).toBe(false);
  });
});

describe('form values', () => {
  it('shows stored values the way the form takes them', () => {
    const [, , , , , value, tds] = MASTERS['work-orders']!.fields;
    expect(toFormValue(value!, 619_957_800)).toBe('6199578.00');
    expect(toFormValue(value!, null)).toBe('');
    expect(toFormValue(tds!, 50)).toBe('0.5');
  });

  it('keeps what the user typed, except the password', () => {
    expect(submittedValues(form([['name', 'A'], ['firms', 'x'], ['firms', 'y'], ['password', 'p'], ['$ACTION_ID_1', '']]))).toEqual({
      name: 'A',
      firms: ['x', 'y'],
    });
  });
});
```

`tests/masters/diff.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { changedFields } from '@/lib/masters/diff';

describe('changedFields', () => {
  it('lists only the fields that changed', () => {
    expect(
      changedFields(
        { id: 'p1', name: 'Ansari', phone: '', created_at: 'a' },
        { id: 'p1', name: 'Ansari Enterprise', phone: '', created_at: 'b' },
      ),
    ).toEqual([{ field: 'name', before: 'Ansari', after: 'Ansari Enterprise' }]);
  });

  it('shows every field for an insert or a delete', () => {
    expect(changedFields(null, { user_id: 'u1', firm_id: 'f1' })).toEqual([
      { field: 'firm_id', before: null, after: 'f1' },
      { field: 'user_id', before: null, after: 'u1' },
    ]);
    expect(changedFields({ user_id: 'u1' }, null)).toEqual([{ field: 'user_id', before: 'u1', after: null }]);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/masters`
Expected: FAIL with `Cannot find package '@/lib/masters/parse'` and `Cannot find package '@/lib/masters/diff'`.

- [ ] **Step 3: Create `src/lib/masters/registry.ts`**

```ts
/** Choices for enum fields. Mirrors the Postgres enums in supabase/migrations. Keep both in sync. */
export const ENUMS = {
  party_kind: ['vendor', 'client', 'worker', 'staff', 'other'],
  contract_type: ['item_rate', 'fixed'],
  money_account_kind: ['bank', 'owner_cash', 'supervisor_cash'],
  role: ['owner', 'office', 'supervisor'],
  language: ['en', 'hi'],
} as const;
export type EnumName = keyof typeof ENUMS;

/** Where a reference field's choices come from. */
export type RefSource = 'firms' | 'sites' | 'clients' | 'supervisors';

export type Field =
  | { name: string; kind: 'text' | 'email' | 'password' | 'rupees' | 'percent' | 'date' | 'checkbox'; required?: boolean }
  | { name: string; kind: 'enum'; enum: EnumName; required?: boolean }
  | { name: string; kind: 'ref' | 'multi'; ref: RefSource; required?: boolean };

export interface MasterDef {
  table: string;
  /** Office staff can view; only the owner can add or edit. */
  ownerOnly: boolean;
  /** Columns shown in the list, in order. */
  list: string[];
  fields: Field[];
}

const active: Field = { name: 'is_active', kind: 'checkbox' };

/** The master-data screens, keyed by URL slug (/masters/<slug>). */
export const MASTERS: Record<string, MasterDef> = {
  firms: {
    table: 'firms',
    ownerOnly: true,
    list: ['code', 'name'],
    fields: [
      { name: 'code', kind: 'text', required: true },
      { name: 'name', kind: 'text', required: true },
    ],
  },
  sites: {
    table: 'sites',
    ownerOnly: true,
    list: ['name', 'location', 'is_active'],
    fields: [{ name: 'name', kind: 'text', required: true }, { name: 'location', kind: 'text' }, active],
  },
  parties: {
    table: 'parties',
    ownerOnly: false,
    list: ['name', 'kind', 'phone', 'is_active'],
    fields: [
      { name: 'kind', kind: 'enum', enum: 'party_kind', required: true },
      { name: 'name', kind: 'text', required: true },
      { name: 'phone', kind: 'text' },
      active,
    ],
  },
  'work-orders': {
    table: 'work_orders',
    ownerOnly: true,
    list: ['ref', 'firm_id', 'client_id', 'site_id', 'contract_type', 'is_active'],
    fields: [
      { name: 'firm_id', kind: 'ref', ref: 'firms', required: true },
      { name: 'client_id', kind: 'ref', ref: 'clients', required: true },
      { name: 'site_id', kind: 'ref', ref: 'sites', required: true },
      { name: 'ref', kind: 'text', required: true },
      { name: 'contract_type', kind: 'enum', enum: 'contract_type', required: true },
      { name: 'contract_value_paise', kind: 'rupees' },
      { name: 'tds_bp', kind: 'percent' },
      { name: 'retention_bp', kind: 'percent' },
      { name: 'security_deposit_bp', kind: 'percent' },
      { name: 'start_date', kind: 'date', required: true },
      active,
    ],
  },
  'money-accounts': {
    table: 'money_accounts',
    ownerOnly: true,
    list: ['name', 'kind', 'firm_id', 'holder_user_id', 'is_active'],
    fields: [
      { name: 'kind', kind: 'enum', enum: 'money_account_kind', required: true },
      { name: 'name', kind: 'text', required: true },
      { name: 'firm_id', kind: 'ref', ref: 'firms' },
      { name: 'holder_user_id', kind: 'ref', ref: 'supervisors' },
      active,
    ],
  },
};

export function getMaster(slug: string): MasterDef | undefined {
  return Object.hasOwn(MASTERS, slug) ? MASTERS[slug] : undefined;
}

export const LOGIN_FIELDS: Field[] = [
  { name: 'email', kind: 'email', required: true },
  { name: 'password', kind: 'password', required: true },
];

const userFields: Field[] = [
  { name: 'full_name', kind: 'text', required: true },
  { name: 'role', kind: 'enum', enum: 'role', required: true },
  { name: 'language', kind: 'enum', enum: 'language', required: true },
  { name: 'firms', kind: 'multi', ref: 'firms' },
  { name: 'sites', kind: 'multi', ref: 'sites' },
];

export const NEW_USER_FIELDS: Field[] = [
  { name: 'email', kind: 'email', required: true },
  { name: 'password', kind: 'password', required: true },
  ...userFields,
];

/** Leaving the password empty keeps the current one. */
export const EDIT_USER_FIELDS: Field[] = [...userFields, active, { name: 'password', kind: 'password' }];

export const LANGUAGE_FIELDS: Field[] = [{ name: 'language', kind: 'enum', enum: 'language', required: true }];
```

- [ ] **Step 4: Create `src/lib/masters/parse.ts`**

```ts
import { assertDate } from '@/lib/ledger/balance';
import { rupeesToPaise } from '@/lib/money';
import { ENUMS, type Field } from './registry';

export type Value = string | number | boolean | null | string[];
export type ParseResult =
  | { ok: true; values: Record<string, Value> }
  | { ok: false; errors: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERCENT = /^\d{1,3}(?:\.\d{1,2})?$/;

/** "1" -> 100, "0.5" -> 50, "12.25" -> 1225 basis points. Accepts 0 to 100 with up to two decimals. */
export function percentToBasisPoints(input: string): number {
  const cleaned = input.replace(/[%\s]/g, '');
  if (!PERCENT.test(cleaned)) {
    throw new Error(`"${input}" is not a valid percentage`);
  }
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const bp = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (bp > 10_000) {
    throw new Error(`"${input}" is more than 100%`);
  }
  return bp;
}

/**
 * Turns submitted form data into column values, or field errors (message keys under `errors.*`).
 * Empty optional fields become the column's empty value; an empty optional password is left out.
 */
export function parseFields(fields: Field[], data: FormData): ParseResult {
  const values: Record<string, Value> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = data.get(field.name);
    const text = typeof raw === 'string' ? raw.trim() : '';

    if (field.kind === 'checkbox') {
      values[field.name] = raw === 'on';
      continue;
    }
    if (field.kind === 'multi') {
      const chosen = data.getAll(field.name).filter((v): v is string => typeof v === 'string');
      if (!chosen.every((v) => UUID.test(v))) errors[field.name] = 'invalid_choice';
      else values[field.name] = chosen;
      continue;
    }
    if (text === '') {
      if (field.required) errors[field.name] = 'required';
      else if (field.kind === 'text') values[field.name] = '';
      else if (field.kind === 'percent') values[field.name] = 0;
      else if (field.kind !== 'password') values[field.name] = null;
      continue;
    }

    switch (field.kind) {
      case 'text':
        values[field.name] = text;
        break;
      case 'email':
        if (EMAIL.test(text)) values[field.name] = text.toLowerCase();
        else errors[field.name] = 'invalid_email';
        break;
      case 'password':
        // Passwords are taken exactly as typed.
        if (typeof raw === 'string' && raw.length >= 8) values[field.name] = raw;
        else errors[field.name] = 'password_short';
        break;
      case 'enum':
        if ((ENUMS[field.enum] as readonly string[]).includes(text)) values[field.name] = text;
        else errors[field.name] = 'invalid_choice';
        break;
      case 'ref':
        if (UUID.test(text)) values[field.name] = text;
        else errors[field.name] = 'invalid_choice';
        break;
      case 'rupees':
        try {
          const paise = rupeesToPaise(text);
          if (paise <= 0) throw new Error('not positive');
          values[field.name] = paise;
        } catch {
          errors[field.name] = 'invalid_amount';
        }
        break;
      case 'percent':
        try {
          values[field.name] = percentToBasisPoints(text);
        } catch {
          errors[field.name] = 'invalid_percent';
        }
        break;
      case 'date':
        try {
          assertDate(text, field.name);
          values[field.name] = text;
        } catch {
          errors[field.name] = 'invalid_date';
        }
        break;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}

/** A stored column value as the form shows it (paise as rupees, basis points as a percentage). */
export function toFormValue(field: Field, value: unknown): string | boolean | string[] {
  if (field.kind === 'checkbox') return Boolean(value);
  if (field.kind === 'multi') return Array.isArray(value) ? value.map(String) : [];
  if (value === null || value === undefined || field.kind === 'password') return '';
  if (field.kind === 'rupees') return (Number(value) / 100).toFixed(2);
  if (field.kind === 'percent') return String(Number(value) / 100);
  return String(value);
}

/** What the user typed, so a form that comes back with errors keeps its input. */
export function submittedValues(data: FormData): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {};
  for (const key of new Set(data.keys())) {
    if (key.startsWith('$') || key === 'password') continue;
    const all = data.getAll(key).filter((v): v is string => typeof v === 'string');
    values[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  return values;
}
```

- [ ] **Step 5: Create `src/lib/masters/diff.ts`**

```ts
export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** The fields that differ between two stored rows (from the master_changes log). */
export function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): FieldChange[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  keys.delete('created_at');
  return [...keys]
    .filter((key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null))
    .sort()
    .map((field) => ({ field, before: before?.[field] ?? null, after: after?.[field] ?? null }));
}
```

- [ ] **Step 6: Run them and confirm they pass**

Run: `npx vitest run tests/masters`
Expected: `Tests  10 passed (10)`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/masters tests/masters
git commit -m "feat: add master field registry and form parsing"
```

---

### Task 6: English and Hindi text

**Files:**
- Create: `messages/en.json`, `messages/hi.json`
- Test: `tests/i18n.test.ts`

- [ ] **Step 1: Write the failing test `tests/i18n.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { ENUMS, MASTERS, NEW_USER_FIELDS, EDIT_USER_FIELDS } from '@/lib/masters/registry';
import en from '../messages/en.json';
import hi from '../messages/hi.json';

type Messages = { [key: string]: string | Messages };

function keys(messages: Messages, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );
}

describe('translations', () => {
  it('has the same keys in English and Hindi, none empty', () => {
    expect(keys(hi).sort()).toEqual(keys(en).sort());
    for (const messages of [en, hi] as Messages[]) {
      const empty = keys(messages).filter((key) => key.split('.').reduce<unknown>((m, k) => (m as Messages)[k], messages) === '');
      expect(empty).toEqual([]);
    }
  });

  it('has a label for every field, master screen and choice', () => {
    const all = new Set(keys(en as Messages));
    const fields = [...Object.values(MASTERS).flatMap((m) => m.fields), ...NEW_USER_FIELDS, ...EDIT_USER_FIELDS];
    const needed = [
      ...fields.map((f) => `fields.${f.name}`),
      ...Object.keys(MASTERS).map((slug) => `masters.${slug}`),
      ...Object.entries(ENUMS).flatMap(([name, values]) => values.map((v) => `options.${name}.${v}`)),
    ];
    expect(needed.filter((key) => !all.has(key))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/i18n.test.ts`
Expected: FAIL, because `messages/en.json` does not exist yet.

- [ ] **Step 3: Create `messages/en.json`**

```json
{
  "app": {
    "name": "Construction Ledger"
  },
  "nav": {
    "home": "Home",
    "masters": "Masters",
    "users": "Users",
    "history": "Change history",
    "settings": "Settings",
    "signOut": "Sign out"
  },
  "login": {
    "title": "Sign in",
    "submit": "Sign in"
  },
  "home": {
    "welcome": "Welcome, {name}",
    "signedInAs": "Signed in as {role}",
    "comingNext": "Money entry forms arrive in the next update. For now, set up the masters below."
  },
  "masters": {
    "firms": "Firms",
    "sites": "Sites",
    "parties": "Parties (vendors, clients, workers)",
    "work-orders": "Work orders",
    "money-accounts": "Bank and cash accounts",
    "add": "Add new",
    "edit": "Edit",
    "save": "Save",
    "empty": "Nothing here yet.",
    "readOnly": "Only the owner can change these."
  },
  "fields": {
    "code": "Short code (2–4 capital letters)",
    "name": "Name",
    "location": "Location",
    "is_active": "Active",
    "kind": "Type",
    "phone": "Phone",
    "firm_id": "Firm",
    "client_id": "Client",
    "site_id": "Site",
    "ref": "Work order number",
    "contract_type": "Contract type",
    "contract_value_paise": "Contract value (₹)",
    "tds_bp": "TDS %",
    "retention_bp": "Retention %",
    "security_deposit_bp": "Security deposit %",
    "start_date": "Start date",
    "holder_user_id": "Supervisor (for supervisor cash)",
    "email": "Email",
    "password": "Password (at least 8 characters)",
    "full_name": "Full name",
    "role": "Role",
    "language": "Language",
    "firms": "Firms (office staff)",
    "sites": "Sites (supervisors)"
  },
  "options": {
    "party_kind": {
      "vendor": "Vendor",
      "client": "Client",
      "worker": "Worker",
      "staff": "Staff",
      "other": "Other"
    },
    "contract_type": {
      "item_rate": "Item rate",
      "fixed": "Fixed value"
    },
    "money_account_kind": {
      "bank": "Bank",
      "owner_cash": "Owner cash",
      "supervisor_cash": "Supervisor cash"
    },
    "role": {
      "owner": "Owner",
      "office": "Office staff",
      "supervisor": "Supervisor"
    },
    "language": {
      "en": "English",
      "hi": "हिन्दी"
    }
  },
  "users": {
    "title": "Users",
    "add": "Add user",
    "keepPassword": "Leave the password empty to keep it."
  },
  "history": {
    "title": "Change history",
    "when": "When",
    "who": "Who",
    "what": "What",
    "changes": "Changes",
    "system": "System (import)",
    "action": {
      "insert": "added",
      "update": "changed",
      "delete": "removed"
    }
  },
  "settings": {
    "title": "Settings",
    "save": "Save"
  },
  "errors": {
    "required": "Required.",
    "invalid_email": "Enter a valid email.",
    "password_short": "At least 8 characters.",
    "invalid_amount": "Enter an amount like 53118.72.",
    "invalid_percent": "Enter a percentage from 0 to 100.",
    "invalid_date": "Enter a real date.",
    "invalid_choice": "Pick one of the choices.",
    "duplicate": "This already exists.",
    "not_allowed": "You are not allowed to do this.",
    "save_failed": "Could not save.",
    "invalid_login": "Wrong email or password.",
    "inactive": "This account is switched off. Ask the owner."
  },
  "common": {
    "yes": "Yes",
    "no": "No",
    "none": "—"
  }
}
```

- [ ] **Step 4: Create `messages/hi.json`**

Have a Hindi speaker (the owner or a supervisor) read these once; fix wording here, keep the keys.

```json
{
  "app": {
    "name": "निर्माण खाता"
  },
  "nav": {
    "home": "होम",
    "masters": "मास्टर",
    "users": "उपयोगकर्ता",
    "history": "बदलाव का इतिहास",
    "settings": "सेटिंग्स",
    "signOut": "लॉग आउट"
  },
  "login": {
    "title": "लॉग इन",
    "submit": "लॉग इन करें"
  },
  "home": {
    "welcome": "नमस्ते, {name}",
    "signedInAs": "भूमिका: {role}",
    "comingNext": "पैसे की एंट्री के फ़ॉर्म अगले अपडेट में आएँगे। अभी नीचे मास्टर तैयार करें।"
  },
  "masters": {
    "firms": "फ़र्म",
    "sites": "साइट",
    "parties": "पार्टी (वेंडर, क्लाइंट, मज़दूर)",
    "work-orders": "वर्क ऑर्डर",
    "money-accounts": "बैंक और नकद खाते",
    "add": "नया जोड़ें",
    "edit": "बदलें",
    "save": "सेव करें",
    "empty": "अभी यहाँ कुछ नहीं है।",
    "readOnly": "इन्हें सिर्फ़ मालिक बदल सकते हैं।"
  },
  "fields": {
    "code": "छोटा कोड (2–4 बड़े अक्षर)",
    "name": "नाम",
    "location": "जगह",
    "is_active": "चालू",
    "kind": "प्रकार",
    "phone": "फ़ोन",
    "firm_id": "फ़र्म",
    "client_id": "क्लाइंट",
    "site_id": "साइट",
    "ref": "वर्क ऑर्डर नंबर",
    "contract_type": "कॉन्ट्रैक्ट का प्रकार",
    "contract_value_paise": "कॉन्ट्रैक्ट की रकम (₹)",
    "tds_bp": "TDS %",
    "retention_bp": "रिटेंशन %",
    "security_deposit_bp": "सिक्योरिटी डिपॉज़िट %",
    "start_date": "शुरू होने की तारीख",
    "holder_user_id": "सुपरवाइज़र (सुपरवाइज़र नकद के लिए)",
    "email": "ईमेल",
    "password": "पासवर्ड (कम से कम 8 अक्षर)",
    "full_name": "पूरा नाम",
    "role": "भूमिका",
    "language": "भाषा",
    "firms": "फ़र्म (ऑफ़िस स्टाफ़)",
    "sites": "साइट (सुपरवाइज़र)"
  },
  "options": {
    "party_kind": {
      "vendor": "वेंडर",
      "client": "क्लाइंट",
      "worker": "मज़दूर",
      "staff": "स्टाफ़",
      "other": "अन्य"
    },
    "contract_type": {
      "item_rate": "आइटम रेट",
      "fixed": "तय रकम"
    },
    "money_account_kind": {
      "bank": "बैंक",
      "owner_cash": "मालिक का नकद",
      "supervisor_cash": "सुपरवाइज़र का नकद"
    },
    "role": {
      "owner": "मालिक",
      "office": "ऑफ़िस स्टाफ़",
      "supervisor": "सुपरवाइज़र"
    },
    "language": {
      "en": "English",
      "hi": "हिन्दी"
    }
  },
  "users": {
    "title": "उपयोगकर्ता",
    "add": "उपयोगकर्ता जोड़ें",
    "keepPassword": "पासवर्ड न बदलना हो तो खाली छोड़ें।"
  },
  "history": {
    "title": "बदलाव का इतिहास",
    "when": "कब",
    "who": "किसने",
    "what": "क्या",
    "changes": "बदलाव",
    "system": "सिस्टम (इम्पोर्ट)",
    "action": {
      "insert": "जोड़ा",
      "update": "बदला",
      "delete": "हटाया"
    }
  },
  "settings": {
    "title": "सेटिंग्स",
    "save": "सेव करें"
  },
  "errors": {
    "required": "ज़रूरी है।",
    "invalid_email": "सही ईमेल डालें।",
    "password_short": "कम से कम 8 अक्षर।",
    "invalid_amount": "53118.72 जैसी रकम डालें।",
    "invalid_percent": "0 से 100 के बीच प्रतिशत डालें।",
    "invalid_date": "सही तारीख डालें।",
    "invalid_choice": "दिए गए विकल्पों में से चुनें।",
    "duplicate": "यह पहले से मौजूद है।",
    "not_allowed": "आपको यह करने की अनुमति नहीं है।",
    "save_failed": "सेव नहीं हो सका।",
    "invalid_login": "ईमेल या पासवर्ड गलत है।",
    "inactive": "यह खाता बंद है। मालिक से पूछें।"
  },
  "common": {
    "yes": "हाँ",
    "no": "नहीं",
    "none": "—"
  }
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `npx vitest run tests/i18n.test.ts`
Expected: `Tests  2 passed (2)`.

- [ ] **Step 6: Commit**

```bash
git add messages tests/i18n.test.ts
git commit -m "feat: add English and Hindi screen text"
```

---

### Task 7: App shell: Supabase session, language, sign-in, home, settings

**Files:**
- Create: `src/lib/supabase/env.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/proxy.ts`, `src/lib/auth.ts`, `src/i18n/locale.ts`, `src/i18n/request.ts`, `src/app/globals.css`, `src/app/layout.tsx`, `src/components/form.tsx`, `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/actions.ts`

This task is checked by building and serving the app (Steps 7–8); the logic it relies on was unit-tested in Tasks 4–6.

- [ ] **Step 1: Supabase clients**

`src/lib/supabase/env.ts`:

```ts
/** Reads a required setting from .env.local (or the hosting environment) and fails loudly if it is missing. */
export function env(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' | 'SUPABASE_SECRET_KEY'): string {
  // Written out in full so Next.js can inline the public values into browser code.
  const value = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  }[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}
```

`src/lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from './env';

/** Supabase as the signed-in user: every query goes through row level security. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}
```

`src/lib/supabase/admin.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Supabase with the secret key: skips row level security. Only for creating logins
 * (server actions, after checking the caller is the owner) and for the import scripts.
 * Never import this from a client component.
 */
export function createAdminClient() {
  return createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 2: Session refresh and sign-in checks**

Next.js 16 calls this file `proxy.ts` (it was `middleware.ts` before). `src/proxy.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/supabase/env';

/** Keeps the Supabase session fresh on every request and sends signed-out visitors to /login. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && !request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
```

`src/lib/auth.ts`:

```ts
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { Locale } from '@/i18n/locale';
import { createClient } from '@/lib/supabase/server';

export type AppRole = 'owner' | 'office' | 'supervisor';

export interface Profile {
  user_id: string;
  email: string;
  full_name: string;
  role: AppRole;
  language: Locale;
  is_active: boolean;
}

/** The signed-in user's profile, or null when signed out or deactivated. One lookup per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return null;
  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle<Profile>();
  return profile?.is_active ? profile : null;
});

/** Sends signed-out users to /login, and users without one of `roles` to the home page. */
export async function requireProfile(...roles: AppRole[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect('/login');
  if (roles.length > 0 && !roles.includes(profile.role)) redirect('/');
  return profile;
}
```

- [ ] **Step 3: Language**

`src/i18n/locale.ts`:

```ts
export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];

/** Set at sign-in from the user's profile, and when they change language in Settings. */
export const LOCALE_COOKIE = 'locale';

export const LOCALE_COOKIE_OPTIONS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' } as const;

export function toLocale(value: string | undefined): Locale {
  return value === 'hi' ? 'hi' : 'en';
}
```

`src/i18n/request.ts`:

```ts
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, toLocale } from './locale';

// No language in the URL: each user's language comes from their profile, via a cookie.
export default getRequestConfig(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
```

- [ ] **Step 4: Root layout and styles**

`src/app/globals.css`:

```css
@import 'tailwindcss';

@layer base {
  input:not([type='checkbox']),
  select {
    @apply w-full rounded border border-gray-400 bg-white px-3 py-2 text-base;
  }
  input:focus-visible,
  select:focus-visible,
  button:focus-visible,
  a:focus-visible {
    @apply outline-2 outline-offset-2 outline-blue-700;
  }
  button[type='submit'] {
    @apply rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50;
  }
  table {
    @apply w-full border-collapse text-sm;
  }
  th,
  td {
    @apply border-b border-gray-200 px-2 py-2 text-left align-top;
  }
  h1 {
    @apply mb-4 text-2xl font-semibold;
  }
  h2 {
    @apply mt-8 mb-3 text-lg font-semibold;
  }
}
```

`src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import './globals.css';

export const metadata: Metadata = { title: 'Construction Ledger' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: The form component**

`src/components/form.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { ENUMS, type Field, type RefSource } from '@/lib/masters/registry';

export interface FormState {
  /** Field name -> message key under `errors.*`; `_form` for the whole form. */
  errors?: Record<string, string>;
  /** Extra detail from the database, shown after a `save_failed` error. */
  detail?: string;
  /** What the user typed, so the form keeps it when it comes back with errors. */
  values?: Record<string, string | string[]>;
}

export type FormAction = (state: FormState, data: FormData) => Promise<FormState>;
export type Choices = Partial<Record<RefSource, { value: string; label: string }[]>>;

const INPUT_TYPES = { text: 'text', email: 'email', password: 'password', rupees: 'text', percent: 'text', date: 'date' } as const;

/** One form for every screen: renders `fields`, posts to a server action, shows its errors. */
export function Form({
  fields,
  defaults = {},
  choices = {},
  action,
  submitLabel,
  passwordAutoComplete = 'new-password',
}: {
  fields: Field[];
  defaults?: Record<string, string | boolean | string[]>;
  choices?: Choices;
  action: FormAction;
  submitLabel: string;
  passwordAutoComplete?: 'current-password' | 'new-password';
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, {});
  const valueOf = (name: string) => state.values?.[name] ?? defaults[name];

  return (
    <form action={formAction} className="grid max-w-lg gap-4">
      {fields.map((field) => {
        const id = `field-${field.name}`;
        const error = state.errors?.[field.name];
        const errorId = error ? `${id}-error` : undefined;
        const value = valueOf(field.name);
        const label = t(`fields.${field.name}`);
        let control: React.ReactNode;

        if (field.kind === 'checkbox') {
          const checked = state.values ? state.values[field.name] === 'on' : value !== false;
          control = (
            <label className="flex items-center gap-2">
              <input type="checkbox" name={field.name} defaultChecked={checked} /> {label}
            </label>
          );
        } else if (field.kind === 'multi') {
          const chosen = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
          control = (
            <fieldset aria-describedby={errorId}>
              <legend className="font-medium">{label}</legend>
              {(choices[field.ref] ?? []).map((choice) => (
                <label key={choice.value} className="flex items-center gap-2">
                  <input type="checkbox" name={field.name} value={choice.value} defaultChecked={chosen.includes(choice.value)} />
                  {choice.label}
                </label>
              ))}
            </fieldset>
          );
        } else {
          const shared = {
            id,
            name: field.name,
            defaultValue: typeof value === 'string' ? value : '',
            required: field.required,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': errorId,
          };
          control = (
            <>
              <label htmlFor={id} className="font-medium">
                {label}
              </label>
              {field.kind === 'enum' || field.kind === 'ref' ? (
                <select {...shared}>
                  <option value="">{t('common.none')}</option>
                  {field.kind === 'enum'
                    ? ENUMS[field.enum].map((option) => (
                        <option key={option} value={option}>
                          {t(`options.${field.enum}.${option}`)}
                        </option>
                      ))
                    : (choices[field.ref] ?? []).map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                </select>
              ) : (
                <input
                  {...shared}
                  type={INPUT_TYPES[field.kind]}
                  inputMode={field.kind === 'rupees' || field.kind === 'percent' ? 'decimal' : undefined}
                  autoComplete={field.kind === 'password' ? passwordAutoComplete : field.kind === 'email' ? 'username' : 'off'}
                />
              )}
            </>
          );
        }

        return (
          <div key={field.name} className="grid gap-1">
            {control}
            {error && (
              <p id={errorId} className="text-sm text-red-700">
                {t(`errors.${error}`)}
              </p>
            )}
          </div>
        );
      })}
      {state.errors?._form && (
        <p role="alert" className="text-red-700">
          {t(`errors.${state.errors._form}`)}
          {state.detail ? ` (${state.detail})` : ''}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {submitLabel}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Sign-in, signed-in shell, home and settings**

`src/app/login/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { getProfile } from '@/lib/auth';
import { LOGIN_FIELDS } from '@/lib/masters/registry';
import { signIn } from './actions';

export default async function LoginPage() {
  if (await getProfile()) redirect('/');
  const t = await getTranslations();
  return (
    <main className="mx-auto max-w-sm p-6">
      <p className="mb-2 text-gray-600">{t('app.name')}</p>
      <h1>{t('login.title')}</h1>
      <Form fields={LOGIN_FIELDS} action={signIn} submitLabel={t('login.submit')} passwordAutoComplete="current-password" />
    </main>
  );
}
```

`src/app/login/actions.ts`:

```ts
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form';
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from '@/i18n/locale';
import { parseFields, submittedValues } from '@/lib/masters/parse';
import { LOGIN_FIELDS } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';

export async function signIn(_state: FormState, data: FormData): Promise<FormState> {
  const values = submittedValues(data);
  const parsed = parseFields(LOGIN_FIELDS, data);
  if (!parsed.ok) return { errors: parsed.errors, values };

  const supabase = await createClient();
  const { data: session, error } = await supabase.auth.signInWithPassword({
    email: String(parsed.values.email),
    password: String(parsed.values.password),
  });
  if (error) return { errors: { _form: 'invalid_login' }, values };

  const { data: profile } = await supabase
    .from('profiles')
    .select('language, is_active')
    .eq('user_id', session.user.id)
    .maybeSingle<{ language: string; is_active: boolean }>();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { errors: { _form: 'inactive' }, values };
  }
  (await cookies()).set(LOCALE_COOKIE, profile.language, LOCALE_COOKIE_OPTIONS);
  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
```

`src/app/(app)/layout.tsx`:

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { signOut } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const t = await getTranslations();
  const links: [string, string][] = [
    ['/', 'nav.home'],
    ...(profile.role !== 'supervisor' ? ([['/masters/firms', 'nav.masters']] as [string, string][]) : []),
    ...(profile.role === 'owner' ? ([['/users', 'nav.users'], ['/history', 'nav.history']] as [string, string][]) : []),
    ['/settings', 'nav.settings'],
  ];
  return (
    <>
      <header className="border-b border-gray-200 bg-white">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 p-3">
          <span className="font-semibold">{t('app.name')}</span>
          {links.map(([href, key]) => (
            <Link key={href} href={href} className="underline-offset-4 hover:underline">
              {t(key)}
            </Link>
          ))}
          <form action={signOut} className="ml-auto">
            <button type="submit">{t('nav.signOut')}</button>
          </form>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </>
  );
}
```

`src/app/(app)/page.tsx`:

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { MASTERS } from '@/lib/masters/registry';

export default async function HomePage() {
  const profile = await requireProfile();
  const t = await getTranslations();
  return (
    <>
      <h1>{t('home.welcome', { name: profile.full_name })}</h1>
      <p>{t('home.signedInAs', { role: t(`options.role.${profile.role}`) })}</p>
      {profile.role !== 'supervisor' && (
        <>
          <p className="mt-4">{t('home.comingNext')}</p>
          <ul className="mt-2 list-disc pl-6">
            {Object.keys(MASTERS).map((slug) => (
              <li key={slug}>
                <Link href={`/masters/${slug}`} className="underline">
                  {t(`masters.${slug}`)}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
```

`src/app/(app)/settings/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { LANGUAGE_FIELDS } from '@/lib/masters/registry';
import { setLanguage } from './actions';

export default async function SettingsPage() {
  const profile = await requireProfile();
  const t = await getTranslations();
  return (
    <>
      <h1>{t('settings.title')}</h1>
      <Form fields={LANGUAGE_FIELDS} defaults={{ language: profile.language }} action={setLanguage} submitLabel={t('settings.save')} />
    </>
  );
}
```

`src/app/(app)/settings/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import type { FormState } from '@/components/form';
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from '@/i18n/locale';
import { requireProfile } from '@/lib/auth';
import { parseFields } from '@/lib/masters/parse';
import { LANGUAGE_FIELDS } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';

export async function setLanguage(_state: FormState, data: FormData): Promise<FormState> {
  await requireProfile();
  const parsed = parseFields(LANGUAGE_FIELDS, data);
  if (!parsed.ok) return { errors: parsed.errors };
  const supabase = await createClient();
  const { error } = await supabase.rpc('app_set_my_language', { p_language: parsed.values.language });
  if (error) return { errors: { _form: 'save_failed' }, detail: error.message };
  (await cookies()).set(LOCALE_COOKIE, String(parsed.values.language), LOCALE_COOKIE_OPTIONS);
  revalidatePath('/', 'layout');
  return {};
}
```

- [ ] **Step 7: Build it**

The build needs the two public settings to exist; placeholders are fine until Task 10.

Run:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npm run build
npm run typecheck
```

Expected: `✓ Compiled successfully`, routes `/`, `/_not-found`, `/login`, `/settings` and `ƒ Proxy (Middleware)`; no type errors.

- [ ] **Step 8: Serve it and check sign-in redirects and both languages**

```bash
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npx next start -p 3917 &
sleep 3
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://localhost:3917/
curl -s http://localhost:3917/login | grep -o '<html lang="[a-z]*"\|<h1>[^<]*</h1>'
curl -s -H 'Cookie: locale=hi' http://localhost:3917/login | grep -o '<html lang="[a-z]*"\|<h1>[^<]*</h1>'
kill %1
```

Expected: `307 -> http://localhost:3917/login`, then `<html lang="en"` `<h1>Sign in</h1>`, then `<html lang="hi"` `<h1>लॉग इन</h1>`.

- [ ] **Step 9: Commit**

```bash
git add src
git commit -m "feat: add app shell with Supabase sign-in, roles and English/Hindi"
```

---

### Task 8: Master data, users and change-history screens

**Files:**
- Create: `src/app/(app)/masters/layout.tsx`, `src/app/(app)/masters/options.ts`, `src/app/(app)/masters/actions.ts`, `src/app/(app)/masters/[table]/page.tsx`, `src/app/(app)/masters/[table]/[id]/page.tsx`, `src/app/(app)/users/page.tsx`, `src/app/(app)/users/[id]/page.tsx`, `src/app/(app)/users/actions.ts`, `src/app/(app)/history/page.tsx`

- [ ] **Step 1: Master screens**

`src/app/(app)/masters/layout.tsx`:

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { MASTERS } from '@/lib/masters/registry';

export default async function MastersLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations();
  return (
    <>
      <nav aria-label={t('nav.masters')} className="mb-6 flex flex-wrap gap-x-4 gap-y-2 border-b border-gray-200 pb-3">
        {Object.keys(MASTERS).map((slug) => (
          <Link key={slug} href={`/masters/${slug}`} className="underline-offset-4 hover:underline">
            {t(`masters.${slug}`)}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
```

`src/app/(app)/masters/options.ts`:

```ts
import type { Choices } from '@/components/form';
import type { Field, RefSource } from '@/lib/masters/registry';
import { formatPaise } from '@/lib/money';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;
type Choice = { value: string; label: string };

async function load(db: Db, source: RefSource): Promise<Choice[]> {
  switch (source) {
    case 'firms': {
      const { data } = await db.from('firms').select('id, code, name').order('code');
      return (data ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }));
    }
    case 'sites': {
      const { data } = await db.from('sites').select('id, name').order('name');
      return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
    }
    case 'clients': {
      const { data } = await db.from('parties').select('id, name').eq('kind', 'client').order('name');
      return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
    }
    case 'supervisors': {
      const { data } = await db.from('profiles').select('user_id, full_name').eq('role', 'supervisor').order('full_name');
      return (data ?? []).map((r) => ({ value: r.user_id, label: r.full_name }));
    }
  }
}

/** Choices for every reference field in `fields`, as the signed-in user may see them. */
export async function loadChoices(db: Db, fields: Field[]): Promise<Choices> {
  const sources = [...new Set(fields.flatMap((f) => (f.kind === 'ref' || f.kind === 'multi' ? [f.ref] : [])))];
  const loaded = await Promise.all(sources.map((source) => load(db, source)));
  return Object.fromEntries(sources.map((source, i) => [source, loaded[i]]));
}

/** A stored value as the list shows it. */
export function displayValue(field: Field, value: unknown, choices: Choices, t: (key: string) => string): string {
  if (field.kind === 'checkbox') return t(value ? 'common.yes' : 'common.no');
  if (value === null || value === undefined || value === '') return t('common.none');
  switch (field.kind) {
    case 'enum':
      return t(`options.${field.enum}.${String(value)}`);
    case 'ref':
      return choices[field.ref]?.find((c) => c.value === value)?.label ?? t('common.none');
    case 'rupees':
      return formatPaise(Number(value));
    case 'percent':
      return `${Number(value) / 100}%`;
    default:
      return String(value);
  }
}
```

`src/app/(app)/masters/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { parseFields, submittedValues } from '@/lib/masters/parse';
import { getMaster } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';

/** Adds (id = null) or edits a master row as the signed-in user. Row level security has the final say. */
export async function saveMaster(slug: string, id: string | null, _state: FormState, data: FormData): Promise<FormState> {
  const def = getMaster(slug);
  const profile = await requireProfile('owner', 'office');
  if (!def || (def.ownerOnly && profile.role !== 'owner')) return { errors: { _form: 'not_allowed' } };

  const values = submittedValues(data);
  const parsed = parseFields(def.fields, data);
  if (!parsed.ok) return { errors: parsed.errors, values };

  const db = await createClient();
  const { error } = id
    ? await db.from(def.table).update(parsed.values as Record<string, unknown>).eq('id', id)
    : await db.from(def.table).insert(parsed.values as Record<string, unknown>);
  if (error) {
    const duplicate = error.code === '23505';
    return { errors: { _form: duplicate ? 'duplicate' : 'save_failed' }, detail: duplicate ? undefined : error.message, values };
  }
  revalidatePath(`/masters/${slug}`);
  redirect(`/masters/${slug}`);
}
```

`src/app/(app)/masters/[table]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { getMaster } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { saveMaster } from '../actions';
import { displayValue, loadChoices } from '../options';

export default async function MasterListPage({ params }: { params: Promise<{ table: string }> }) {
  const { table: slug } = await params;
  const def = getMaster(slug);
  if (!def) notFound();
  const profile = await requireProfile('owner', 'office');
  const canEdit = !def.ownerOnly || profile.role === 'owner';
  const db = await createClient();
  const [{ data: rows }, choices, t] = await Promise.all([
    db.from(def.table).select('*').order(def.list[0]!),
    loadChoices(db, def.fields),
    getTranslations(),
  ]);
  const fieldByName = new Map(def.fields.map((f) => [f.name, f]));

  return (
    <>
      <h1>{t(`masters.${slug}`)}</h1>
      {!canEdit && <p className="mb-4 text-gray-600">{t('masters.readOnly')}</p>}
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                {def.list.map((column) => (
                  <th key={column}>{t(`fields.${column}`)}</th>
                ))}
                {canEdit && <th aria-label={t('masters.edit')} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {def.list.map((column) => (
                    <td key={column}>{displayValue(fieldByName.get(column)!, row[column], choices, t)}</td>
                  ))}
                  {canEdit && (
                    <td>
                      <Link href={`/masters/${slug}/${row.id}`} className="underline">
                        {t('masters.edit')}
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{t('masters.empty')}</p>
      )}
      {canEdit && (
        <>
          <h2>{t('masters.add')}</h2>
          <Form fields={def.fields} choices={choices} action={saveMaster.bind(null, slug, null)} submitLabel={t('masters.save')} />
        </>
      )}
    </>
  );
}
```

`src/app/(app)/masters/[table]/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { toFormValue } from '@/lib/masters/parse';
import { getMaster } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { saveMaster } from '../../actions';
import { loadChoices } from '../../options';

export default async function MasterEditPage({ params }: { params: Promise<{ table: string; id: string }> }) {
  const { table: slug, id } = await params;
  const def = getMaster(slug);
  if (!def) notFound();
  const profile = await requireProfile('owner', 'office');
  if (def.ownerOnly && profile.role !== 'owner') redirect(`/masters/${slug}`);
  const db = await createClient();
  const { data: row } = await db.from(def.table).select('*').eq('id', id).maybeSingle();
  if (!row) notFound();
  const [choices, t] = await Promise.all([loadChoices(db, def.fields), getTranslations()]);
  const defaults = Object.fromEntries(def.fields.map((f) => [f.name, toFormValue(f, row[f.name])]));

  return (
    <>
      <p className="mb-2">
        <Link href={`/masters/${slug}`} className="underline">
          ← {t(`masters.${slug}`)}
        </Link>
      </p>
      <h1>
        {t('masters.edit')}: {String(row.name ?? row.ref ?? row.code)}
      </h1>
      <Form fields={def.fields} defaults={defaults} choices={choices} action={saveMaster.bind(null, slug, id)} submitLabel={t('masters.save')} />
    </>
  );
}
```

- [ ] **Step 2: User screens (owner only)**

`src/app/(app)/users/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { parseFields, submittedValues } from '@/lib/masters/parse';
import { EDIT_USER_FIELDS, NEW_USER_FIELDS } from '@/lib/masters/registry';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;

interface UserValues {
  email: string;
  password?: string;
  full_name: string;
  role: string;
  language: string;
  is_active?: boolean;
  firms: string[];
  sites: string[];
}

/**
 * Makes a user's assigned firms or sites exactly `wanted`. Runs as the owner (not the secret key)
 * so the change history records who did it. Returns an error message, or null.
 */
async function syncAssignments(
  db: Db,
  table: 'user_firms' | 'user_sites',
  column: 'firm_id' | 'site_id',
  userId: string,
  wanted: string[],
): Promise<string | null> {
  const { data, error } = await db.from(table).select(column).eq('user_id', userId);
  if (error) return error.message;
  const current = (data as Record<string, string>[]).map((row) => row[column]!);
  const removed = current.filter((v) => !wanted.includes(v));
  const added = wanted.filter((v) => !current.includes(v));
  if (removed.length > 0) {
    const { error: e } = await db.from(table).delete().eq('user_id', userId).in(column, removed);
    if (e) return e.message;
  }
  if (added.length > 0) {
    const { error: e } = await db.from(table).insert(added.map((v) => ({ user_id: userId, [column]: v })));
    if (e) return e.message;
  }
  return null;
}

/** The owner creates every login (no self sign-up): email + password, then the profile and assignments. */
export async function createUser(_state: FormState, data: FormData): Promise<FormState> {
  await requireProfile('owner');
  const values = submittedValues(data);
  const parsed = parseFields(NEW_USER_FIELDS, data);
  if (!parsed.ok) return { errors: parsed.errors, values };
  const user = parsed.values as unknown as UserValues;

  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });
  if (error || !created.user) {
    const duplicate = error?.code === 'email_exists';
    return { errors: { _form: duplicate ? 'duplicate' : 'save_failed' }, detail: duplicate ? undefined : error?.message, values };
  }

  const db = await createClient();
  const userId = created.user.id;
  const { error: profileError } = await db
    .from('profiles')
    .insert({ user_id: userId, email: user.email, full_name: user.full_name, role: user.role, language: user.language });
  if (profileError) {
    await admin.auth.admin.deleteUser(userId); // no profile yet, so nothing else points at this login
    return { errors: { _form: 'save_failed' }, detail: profileError.message, values };
  }
  const failure =
    (await syncAssignments(db, 'user_firms', 'firm_id', userId, user.firms)) ??
    (await syncAssignments(db, 'user_sites', 'site_id', userId, user.sites));
  if (failure) return { errors: { _form: 'save_failed' }, detail: failure, values };

  revalidatePath('/users');
  redirect('/users');
}

export async function updateUser(userId: string, _state: FormState, data: FormData): Promise<FormState> {
  const owner = await requireProfile('owner');
  const values = submittedValues(data);
  const parsed = parseFields(EDIT_USER_FIELDS, data);
  if (!parsed.ok) return { errors: parsed.errors, values };
  const user = parsed.values as unknown as UserValues;
  // Never let the owner lock themselves out.
  if (userId === owner.user_id && (user.role !== 'owner' || !user.is_active)) {
    return { errors: { _form: 'not_allowed' }, values };
  }

  const db = await createClient();
  const { error } = await db
    .from('profiles')
    .update({ full_name: user.full_name, role: user.role, language: user.language, is_active: user.is_active })
    .eq('user_id', userId);
  const failure =
    error?.message ??
    (await syncAssignments(db, 'user_firms', 'firm_id', userId, user.firms)) ??
    (await syncAssignments(db, 'user_sites', 'site_id', userId, user.sites));
  if (failure) return { errors: { _form: 'save_failed' }, detail: failure, values };

  if (user.password) {
    const { error: e } = await createAdminClient().auth.admin.updateUserById(userId, { password: user.password });
    if (e) return { errors: { _form: 'save_failed' }, detail: e.message, values };
  }
  revalidatePath('/users');
  redirect('/users');
}
```

`src/app/(app)/users/page.tsx`:

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { requireProfile, type Profile } from '@/lib/auth';
import { NEW_USER_FIELDS } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../masters/options';
import { createUser } from './actions';

export default async function UsersPage() {
  await requireProfile('owner');
  const db = await createClient();
  const [{ data: users }, choices, t] = await Promise.all([
    db.from('profiles').select('*').order('full_name').returns<Profile[]>(),
    loadChoices(db, NEW_USER_FIELDS),
    getTranslations(),
  ]);

  return (
    <>
      <h1>{t('users.title')}</h1>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>{t('fields.full_name')}</th>
              <th>{t('fields.email')}</th>
              <th>{t('fields.role')}</th>
              <th>{t('fields.language')}</th>
              <th>{t('fields.is_active')}</th>
              <th aria-label={t('masters.edit')} />
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((user) => (
              <tr key={user.user_id}>
                <td>{user.full_name}</td>
                <td>{user.email}</td>
                <td>{t(`options.role.${user.role}`)}</td>
                <td>{t(`options.language.${user.language}`)}</td>
                <td>{t(user.is_active ? 'common.yes' : 'common.no')}</td>
                <td>
                  <Link href={`/users/${user.user_id}`} className="underline">
                    {t('masters.edit')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>{t('users.add')}</h2>
      <Form fields={NEW_USER_FIELDS} choices={choices} action={createUser} submitLabel={t('users.add')} />
    </>
  );
}
```

`src/app/(app)/users/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Form } from '@/components/form';
import { requireProfile, type Profile } from '@/lib/auth';
import { EDIT_USER_FIELDS } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../../masters/options';
import { updateUser } from '../actions';

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireProfile('owner');
  const db = await createClient();
  const { data: user } = await db.from('profiles').select('*').eq('user_id', id).maybeSingle<Profile>();
  if (!user) notFound();
  const [{ data: firms }, { data: sites }, choices, t] = await Promise.all([
    db.from('user_firms').select('firm_id').eq('user_id', id),
    db.from('user_sites').select('site_id').eq('user_id', id),
    loadChoices(db, EDIT_USER_FIELDS),
    getTranslations(),
  ]);
  const defaults = {
    full_name: user.full_name,
    role: user.role,
    language: user.language,
    is_active: user.is_active,
    firms: (firms ?? []).map((r) => r.firm_id as string),
    sites: (sites ?? []).map((r) => r.site_id as string),
  };

  return (
    <>
      <p className="mb-2">
        <Link href="/users" className="underline">
          ← {t('users.title')}
        </Link>
      </p>
      <h1>{user.full_name}</h1>
      <p className="mb-4 text-gray-600">
        {user.email} · {t('users.keepPassword')}
      </p>
      <Form fields={EDIT_USER_FIELDS} defaults={defaults} choices={choices} action={updateUser.bind(null, id)} submitLabel={t('masters.save')} />
    </>
  );
}
```

- [ ] **Step 3: Change history (owner only)**

`src/app/(app)/history/page.tsx`:

```tsx
import { getLocale, getTranslations } from 'next-intl/server';
import { requireProfile } from '@/lib/auth';
import { changedFields } from '@/lib/masters/diff';
import { createClient } from '@/lib/supabase/server';

interface Change {
  id: number;
  table_name: string;
  row_key: string;
  action: 'insert' | 'update' | 'delete';
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  changed_by: string | null;
  changed_at: string;
}

const show = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/** Spec rule 11: who changed which master record, from what to what. Latest 200 changes. */
export default async function HistoryPage() {
  await requireProfile('owner');
  const db = await createClient();
  const [{ data: changes }, { data: people }, t, locale] = await Promise.all([
    db.from('master_changes').select('*').order('id', { ascending: false }).limit(200).returns<Change[]>(),
    db.from('profiles').select('user_id, full_name'),
    getTranslations(),
    getLocale(),
  ]);
  const names = new Map((people ?? []).map((p) => [p.user_id as string, p.full_name as string]));
  const when = new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <>
      <h1>{t('history.title')}</h1>
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>{t('history.when')}</th>
              <th>{t('history.who')}</th>
              <th>{t('history.what')}</th>
              <th>{t('history.changes')}</th>
            </tr>
          </thead>
          <tbody>
            {(changes ?? []).map((change) => {
              const row = change.new_row ?? change.old_row ?? {};
              return (
                <tr key={change.id}>
                  <td className="whitespace-nowrap">{when.format(new Date(change.changed_at))}</td>
                  <td>{change.changed_by ? (names.get(change.changed_by) ?? change.changed_by) : t('history.system')}</td>
                  <td>
                    {change.table_name} {t(`history.action.${change.action}`)}: {show(row.name ?? row.ref ?? row.full_name ?? change.row_key)}
                  </td>
                  <td>
                    <ul>
                      {changedFields(change.old_row, change.new_row).map((c) => (
                        <li key={c.field}>
                          {c.field}: {show(c.before)} → {show(c.after)}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Build and type-check**

Run:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npm run build
npm run typecheck
```

Expected: routes `/`, `/_not-found`, `/history`, `/login`, `/masters/[table]`, `/masters/[table]/[id]`, `/settings`, `/users`, `/users/[id]`; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: add master-data, user and change-history screens"
```

---

### Task 9: Opening-balance import tools

**Files:**
- Create: `src/lib/openings/openings.ts`, `scripts/dump-workbook.ts`, `scripts/openings-extract.ts`, `scripts/openings-import.ts`, `scripts/create-owner.ts`
- Test: `tests/openings/openings.test.ts`

How the import works: **extract** reads one outstanding workbook and writes a review sheet `data/private/openings-<FIRM>.xlsx` (columns `kind | firm | name | source | amount`). The owner cleans vendor names there and adds bank/cash/client rows. **import** refuses to post anything unless each firm's vendor rows add up exactly to the statement total (₹61,99,578 for JI, ₹16,71,606 for AB), posts each row with a fixed entry id, then re-reads the database and prints the reconciliation.

The real workbooks were not available when this plan was written, so `extractVendorOpenings` assumes the layout the spec describes (one sheet per vendor with an opening amount). Task 11 Step 2 checks the real files and adjusts this one function if needed; the totals check stops a wrong extraction from being imported.

- [ ] **Step 1: Write the failing test `tests/openings/openings.test.ts`**

```ts
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  cellToPaise,
  checkVendorTotals,
  extractVendorOpenings,
  openingDraft,
  openingEntryId,
  readReviewSheet,
  writeReviewSheet,
  type OpeningRow,
} from '@/lib/openings/openings';

/** A workbook in the layout the spec describes: one sheet per vendor, an opening amount, an empty payment table. */
function outstandingWorkbook(vendors: [string, number][]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  for (const [name, amount] of vendors) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow([name]);
    sheet.addRow(['Statement date', '21-10-2026']);
    sheet.addRow(['Opening outstanding', amount]);
    sheet.addRow([]);
    sheet.addRow(['Date', 'Payment', 'Mode', 'Balance']);
  }
  return workbook;
}

const row = (overrides: Partial<OpeningRow>): OpeningRow => ({
  line: 2, kind: 'vendor', firm: 'JI', name: 'Ansari Enterprise', source: 'Ansari Enterprise', amountPaise: 100, ...overrides,
});

describe('cellToPaise', () => {
  it('accepts exact rupee amounts from numbers, formulas and text', () => {
    expect(cellToPaise(1330193)).toBe(133_019_300);
    expect(cellToPaise(53118.72)).toBe(5_311_872);
    expect(cellToPaise({ formula: 'A1+A2', result: 0.1 + 0.2 })).toBe(30);
    expect(cellToPaise('61,99,578')).toBe(619_957_800);
  });

  it('refuses fractions of a paisa and empty cells', () => {
    expect(() => cellToPaise(12.345)).toThrow('not an exact rupee amount');
    expect(() => cellToPaise(null)).toThrow('expected an amount');
  });
});

describe('extractVendorOpenings', () => {
  it('reads one opening amount per vendor sheet and reports sheets it could not read', () => {
    const workbook = outstandingWorkbook([['Ansari Enterprise', 1330193], ['Briks SVG Site', 250000.5]]);
    workbook.addWorksheet('Notes').addRow(['nothing here']);
    expect(extractVendorOpenings(workbook)).toEqual({
      openings: [
        { sourceName: 'Ansari Enterprise', amountPaise: 133_019_300 },
        { sourceName: 'Briks SVG Site', amountPaise: 25_000_050 },
      ],
      skippedSheets: ['Notes'],
    });
  });
});

describe('the review sheet', () => {
  it('round-trips rows and reads back what the owner edited', async () => {
    const workbook = new ExcelJS.Workbook();
    writeReviewSheet(workbook, [
      { kind: 'vendor', firm: 'JI', name: 'Briks SVG Site', source: 'Briks SVG Site', amountPaise: 25_000_050 },
    ]);
    const sheet = workbook.getWorksheet('openings')!;
    sheet.getCell('C2').value = 'Shree Bricks'; // the owner cleans the name
    sheet.addRow(['money', '', 'Owner cash', '', 30000]);
    const reread = new ExcelJS.Workbook();
    await reread.xlsx.load(await workbook.xlsx.writeBuffer());
    expect(readReviewSheet(reread)).toEqual([
      { line: 2, kind: 'vendor', firm: 'JI', name: 'Shree Bricks', source: 'Briks SVG Site', amountPaise: 25_000_050 },
      { line: 3, kind: 'money', firm: '', name: 'Owner cash', source: '', amountPaise: 3_000_000 },
    ]);
  });

  it('lists every bad row instead of importing part of the file', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('openings');
    sheet.addRow(['kind', 'firm', 'name', 'source', 'amount']);
    sheet.addRow(['vendr', 'JI', 'A', '', 1]);
    sheet.addRow(['vendor', '', 'B', '', 1]);
    sheet.addRow(['vendor', 'JI', 'C', '', 0]);
    expect(() => readReviewSheet(workbook)).toThrow(
      /row 2: kind must be vendor, money, client\nrow 3: firm code is required\nrow 4: amount cannot be zero/,
    );
  });
});

describe('checkVendorTotals', () => {
  it('passes only when each firm matches its statement total exactly', () => {
    const expected = { JI: 300, AB: 50 };
    expect(() => checkVendorTotals([row({ amountPaise: 100 }), row({ amountPaise: 200 }), row({ firm: 'AB', amountPaise: 50 })], expected)).not.toThrow();
    expect(() => checkVendorTotals([row({ amountPaise: 299 })], expected)).toThrow(
      'firm JI: vendor rows add up to ₹2.99, statements say ₹3.00',
    );
    expect(() => checkVendorTotals([row({ firm: 'XX' })], expected)).toThrow('no expected vendor total for firm XX');
  });

  it('matches the real statement totals from the spec', () => {
    expect(() => checkVendorTotals([row({ amountPaise: 619_957_800 }), row({ firm: 'AB', amountPaise: 167_160_600 })])).not.toThrow();
  });
});

describe('opening entries', () => {
  it('give the same row the same id every time, ignoring name case', () => {
    expect(openingEntryId(row({}))).toBe(openingEntryId(row({ name: 'ANSARI ENTERPRISE', line: 9 })));
    expect(openingEntryId(row({}))).not.toBe(openingEntryId(row({ firm: 'AB' })));
    expect(openingEntryId(row({}))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('post vendor openings on the statement date, keeping the original name as the reference', () => {
    const draft = openingDraft(row({ name: 'Shree Bricks', source: 'Briks SVG Site', amountPaise: 500 }), {
      kind: 'vendor', firmId: 'firm-ji', vendorId: 'party-1',
    });
    expect(draft).toMatchObject({ entryType: 'opening', entryDate: '2026-10-21', reference: 'Briks SVG Site' });
    expect(draft.lines).toEqual([
      { account: 'opening_balance', amountPaise: 500 },
      { account: 'vendor_payable', amountPaise: -500, firmId: 'firm-ji', partyId: 'party-1' },
    ]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/openings`
Expected: FAIL with `Cannot find package '@/lib/openings/openings'`.

- [ ] **Step 3: Create `src/lib/openings/openings.ts`**

```ts
import { createHash } from 'node:crypto';
import type { CellValue, Workbook } from 'exceljs';
import { openingClientBalance, openingMoneyBalance, openingVendorBalance } from '@/lib/ledger/posting/opening';
import type { EntryDraft, MoneyAccountRef, WorkOrderRef } from '@/lib/ledger/types';
import { formatPaise, rupeesToPaise, type Paise } from '@/lib/money';

/** The date of the vendor statements in the two outstanding workbooks (spec section 8). */
export const OPENING_DATE = '2026-10-21';

/** Vendor totals the import must match exactly, per firm code (spec section 14). */
export const EXPECTED_VENDOR_TOTALS: Record<string, Paise> = {
  JI: 619_957_800, // Jayraj Infra ₹61,99,578
  AB: 167_160_600, // A B Infra ₹16,71,606
};

export const OPENING_KINDS = ['vendor', 'money', 'client'] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];

/**
 * One reviewed opening balance. `name` is the cleaned vendor name, the money account name,
 * or the work order ref. `source` is the original name in the workbook, kept for reference.
 * Positive amount: we owe the vendor / money we hold / the client owes us.
 */
export interface OpeningRow {
  line: number;
  kind: OpeningKind;
  firm: string;
  name: string;
  source: string;
  amountPaise: Paise;
}

export const REVIEW_SHEET = 'openings';
const REVIEW_COLUMNS = ['kind', 'firm', 'name', 'source', 'amount'] as const;

/** Excel cells hold floats; accept them only when they are a whole number of paise. */
export function cellToPaise(value: CellValue): Paise {
  const raw = value !== null && typeof value === 'object' && 'result' in value ? value.result : value;
  if (typeof raw === 'number') {
    const paise = Math.round(raw * 100);
    if (!Number.isSafeInteger(paise) || Math.abs(raw * 100 - paise) > 1e-6) {
      throw new Error(`${raw} is not an exact rupee amount`);
    }
    return paise;
  }
  if (typeof raw === 'string') {
    return rupeesToPaise(raw);
  }
  throw new Error(`expected an amount, got ${JSON.stringify(raw)}`);
}

const cellText = (value: CellValue): string =>
  value === null || value === undefined ? '' : typeof value === 'object' && 'richText' in value
    ? value.richText.map((part) => part.text).join('')
    : String(value);

/**
 * Reads vendor opening balances from an outstanding workbook.
 * Layout assumed from the spec: one worksheet per vendor, named after the vendor, with the
 * opening amount in the first numeric cell to the right of a cell saying "opening" or "outstanding".
 * Check this against the real files first (Task 9, Step 1) and adjust here if they differ.
 */
export function extractVendorOpenings(workbook: Workbook): {
  openings: { sourceName: string; amountPaise: Paise }[];
  skippedSheets: string[];
} {
  const openings: { sourceName: string; amountPaise: Paise }[] = [];
  const skippedSheets: string[] = [];
  for (const sheet of workbook.worksheets) {
    let amountPaise: Paise | undefined;
    sheet.eachRow((row) => {
      if (amountPaise !== undefined) return;
      const cells = Array.isArray(row.values) ? row.values : [];
      const labelAt = cells.findIndex((v) => /opening|outstanding/i.test(cellText(v ?? null)));
      if (labelAt < 0) return;
      const amount = cells.slice(labelAt + 1).find((v) => {
        const raw = v !== null && typeof v === 'object' && 'result' in v ? v.result : v;
        return typeof raw === 'number';
      });
      if (amount !== undefined) amountPaise = cellToPaise(amount);
    });
    if (amountPaise === undefined) skippedSheets.push(sheet.name);
    else openings.push({ sourceName: sheet.name.trim(), amountPaise });
  }
  return { openings, skippedSheets };
}

/** Writes rows to the sheet the owner reviews (and cleans vendor names in) before importing. */
export function writeReviewSheet(workbook: Workbook, rows: Omit<OpeningRow, 'line'>[]): void {
  const sheet = workbook.addWorksheet(REVIEW_SHEET);
  sheet.addRow([...REVIEW_COLUMNS]);
  for (const row of rows) {
    sheet.addRow([row.kind, row.firm, row.name, row.source, row.amountPaise / 100]);
  }
}

/** Reads the reviewed sheet. Throws listing every bad row, so nothing is half-imported. */
export function readReviewSheet(workbook: Workbook): OpeningRow[] {
  const sheet = workbook.getWorksheet(REVIEW_SHEET);
  if (!sheet) {
    throw new Error(`no "${REVIEW_SHEET}" sheet in this workbook`);
  }
  const header = REVIEW_COLUMNS.map((_, i) => cellText(sheet.getRow(1).getCell(i + 1).value).trim().toLowerCase());
  if (header.join(',') !== REVIEW_COLUMNS.join(',')) {
    throw new Error(`the first row must be: ${REVIEW_COLUMNS.join(', ')}`);
  }
  const rows: OpeningRow[] = [];
  const problems: string[] = [];
  sheet.eachRow((row, line) => {
    if (line === 1) return;
    const [kind, firm, name, source] = [1, 2, 3, 4].map((col) => cellText(row.getCell(col).value).trim());
    if (!kind && !name) return; // blank line
    try {
      if (!(OPENING_KINDS as readonly string[]).includes(kind!)) throw new Error(`kind must be ${OPENING_KINDS.join(', ')}`);
      if (!name) throw new Error('name is required');
      if (kind !== 'money' && !firm) throw new Error('firm code is required');
      const amountPaise = cellToPaise(row.getCell(5).value);
      if (amountPaise === 0) throw new Error('amount cannot be zero');
      rows.push({ line, kind: kind as OpeningKind, firm: firm!.toUpperCase(), name: name!, source: source!, amountPaise });
    } catch (error) {
      problems.push(`row ${line}: ${(error as Error).message}`);
    }
  });
  if (problems.length > 0) {
    throw new Error(`fix these rows and run again:\n${problems.join('\n')}`);
  }
  return rows;
}

/** Vendor rows must add up exactly to the statement totals before anything is posted. */
export function checkVendorTotals(rows: OpeningRow[], expected: Record<string, Paise> = EXPECTED_VENDOR_TOTALS): void {
  const totals = new Map<string, Paise>();
  for (const row of rows.filter((r) => r.kind === 'vendor')) {
    totals.set(row.firm, (totals.get(row.firm) ?? 0) + row.amountPaise);
  }
  const problems: string[] = [];
  for (const [firm, total] of totals) {
    if (!(firm in expected)) problems.push(`no expected vendor total for firm ${firm}`);
    else if (total !== expected[firm]) {
      problems.push(`firm ${firm}: vendor rows add up to ${formatPaise(total)}, statements say ${formatPaise(expected[firm]!)}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}

/** The same row always gets the same entry id, so running the import twice posts nothing twice. */
export function openingEntryId(row: Pick<OpeningRow, 'kind' | 'firm' | 'name'>): string {
  const h = createHash('sha256').update(`opening|${row.kind}|${row.firm}|${row.name.toLowerCase()}`).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type OpeningRefs =
  | { kind: 'vendor'; firmId: string; vendorId: string }
  | { kind: 'money'; account: MoneyAccountRef }
  | { kind: 'client'; workOrder: WorkOrderRef };

export function openingDraft(row: OpeningRow, refs: OpeningRefs): EntryDraft {
  const id = openingEntryId(row);
  switch (refs.kind) {
    case 'vendor':
      return openingVendorBalance({
        id, firmId: refs.firmId, vendorId: refs.vendorId, amountPaise: row.amountPaise, asOf: OPENING_DATE,
        reference: row.source === row.name ? '' : row.source,
      });
    case 'money':
      return openingMoneyBalance({ id, account: refs.account, amountPaise: row.amountPaise, asOf: OPENING_DATE });
    case 'client':
      return openingClientBalance({ id, workOrder: refs.workOrder, amountPaise: row.amountPaise, asOf: OPENING_DATE });
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/openings`
Expected: `Tests  9 passed (9)`.

- [ ] **Step 5: Create the scripts**

`scripts/dump-workbook.ts`:

```ts
// Prints every sheet's non-empty cells, to check a workbook's real layout before extracting from it.
import ExcelJS from 'exceljs';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run openings:dump -- <workbook.xlsx>');
  process.exit(1);
}
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);
for (const sheet of workbook.worksheets) {
  console.log(`\n=== sheet "${sheet.name}" (${sheet.rowCount} rows)`);
  sheet.eachRow((row, number) => {
    if (number > 40) return;
    const cells: string[] = [];
    row.eachCell((cell) => cells.push(`${cell.address}=${JSON.stringify(cell.value)}`));
    console.log(cells.join('  '));
  });
}
```

`scripts/openings-extract.ts`:

```ts
// Reads one outstanding workbook and writes a review sheet to data/private/ for the owner to check.
import { existsSync, mkdirSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { formatPaise } from '@/lib/money';
import { EXPECTED_VENDOR_TOTALS, extractVendorOpenings, writeReviewSheet } from '@/lib/openings/openings';

const [file, firmArg] = process.argv.slice(2);
if (!file || !firmArg) {
  console.error('usage: npm run openings:extract -- <outstanding.xlsx> <firm code, e.g. JI>');
  process.exit(1);
}
const firm = firmArg.toUpperCase();
const target = `data/private/openings-${firm}.xlsx`;
if (existsSync(target)) {
  console.error(`${target} already exists and may hold your edits. Delete it first to extract again.`);
  process.exit(1);
}

const source = new ExcelJS.Workbook();
await source.xlsx.readFile(file);
const { openings, skippedSheets } = extractVendorOpenings(source);
const review = new ExcelJS.Workbook();
writeReviewSheet(
  review,
  openings.map((o) => ({ kind: 'vendor', firm, name: o.sourceName, source: o.sourceName, amountPaise: o.amountPaise })),
);
mkdirSync('data/private', { recursive: true });
await review.xlsx.writeFile(target);

const total = openings.reduce((sum, o) => sum + o.amountPaise, 0);
const expected = EXPECTED_VENDOR_TOTALS[firm];
console.log(`${openings.length} vendors, total ${formatPaise(total)}; statements say ${expected ? formatPaise(expected) : '(unknown firm code)'}.`);
if (skippedSheets.length > 0) console.log(`Sheets without an opening amount, check them: ${skippedSheets.join(', ')}`);
console.log(`Now open ${target}, clean the vendor names in the "name" column, add any money/client rows, then run:`);
console.log(`  npm run openings:import -- ${target}`);
```

`scripts/openings-import.ts`:

```ts
// Posts reviewed opening balances to Supabase. Safe to run again: each row has a fixed entry id.
import ExcelJS from 'exceljs';
import type { MoneyAccountRef, WorkOrderRef } from '@/lib/ledger/types';
import { formatPaise } from '@/lib/money';
import {
  checkVendorTotals,
  EXPECTED_VENDOR_TOTALS,
  openingDraft,
  readReviewSheet,
  type OpeningRefs,
  type OpeningRow,
} from '@/lib/openings/openings';
import { createAdminClient } from '@/lib/supabase/admin';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: npm run openings:import -- data/private/openings-JI.xlsx [more files]');
  process.exit(1);
}

const rows: OpeningRow[] = [];
for (const file of files) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  rows.push(...readReviewSheet(workbook));
}
checkVendorTotals(rows); // nothing is written unless every firm's vendor rows match the statements

const db = createAdminClient();
const must = <T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => {
  if (result.error || result.data === null || result.data === undefined) {
    throw new Error(`${what}: ${result.error?.message ?? 'not found'}`);
  }
  return result.data;
};

const owner = must(
  await db.from('profiles').select('user_id').eq('role', 'owner').eq('is_active', true).limit(1).maybeSingle(),
  'an active owner account (run npm run create-owner first)',
);
const firms = new Map(must(await db.from('firms').select('id, code'), 'firms').map((f) => [f.code as string, f.id as string]));

// Resolve every row first, so a typo stops the import before anything is posted.
const resolved: { row: OpeningRow; refs: OpeningRefs }[] = [];
for (const row of rows) {
  const where = `row ${row.line} (${row.name})`;
  const firmId = row.firm ? firms.get(row.firm) : undefined;
  if (row.firm && !firmId) throw new Error(`${where}: no firm with code ${row.firm}; add it under Masters → Firms`);
  if (row.kind === 'vendor') {
    const existing = await db.from('parties').select('id').eq('kind', 'vendor').eq('name', row.name).maybeSingle();
    const vendorId =
      (existing.data?.id as string | undefined) ??
      (must(await db.from('parties').insert({ kind: 'vendor', name: row.name }).select('id').single(), `${where}: add vendor`)
        .id as string);
    resolved.push({ row, refs: { kind: 'vendor', firmId: firmId!, vendorId } });
  } else if (row.kind === 'money') {
    const a = must(
      await db.from('money_accounts').select('id, kind, firm_id').eq('name', row.name).maybeSingle(),
      `${where}: no money account with this name; add it under Masters → Bank and cash accounts`,
    );
    const account: MoneyAccountRef = { id: a.id, kind: a.kind, firmId: a.firm_id };
    resolved.push({ row, refs: { kind: 'money', account } });
  } else {
    const w = must(
      await db.from('work_orders').select('id, firm_id, client_id, site_id').eq('firm_id', firmId!).eq('ref', row.name).maybeSingle(),
      `${where}: no work order with this number for firm ${row.firm}`,
    );
    const workOrder: WorkOrderRef = { id: w.id, firmId: w.firm_id, clientId: w.client_id, siteId: w.site_id };
    resolved.push({ row, refs: { kind: 'client', workOrder } });
  }
}

let posted = 0;
let already = 0;
const entryIds: string[] = [];
for (const { row, refs } of resolved) {
  const result = must(
    await db.rpc('post_entry', { p_entry: openingDraft(row, refs), p_actor: owner.user_id }),
    `row ${row.line} (${row.name}): posting`,
  ) as { id: string; serial: string; duplicate: boolean };
  entryIds.push(result.id);
  if (result.duplicate) already++;
  else posted++;
}
console.log(`Posted ${posted} opening entries; ${already} were already posted.`);

// Reconcile from what the database now holds, not from the file.
const lines = must(
  await db.from('entry_lines').select('firm_id, amount_paise').eq('account', 'vendor_payable').in('entry_id', entryIds),
  'reconciliation',
);
for (const [code, expected] of Object.entries(EXPECTED_VENDOR_TOTALS)) {
  const firmId = firms.get(code);
  if (!rows.some((r) => r.kind === 'vendor' && r.firm === code)) continue;
  const owed = -lines.filter((l) => l.firm_id === firmId).reduce((sum, l) => sum + Number(l.amount_paise), 0);
  const ok = owed === expected;
  console.log(`${code}: owed to vendors ${formatPaise(owed)}, statements ${formatPaise(expected)} ${ok ? 'OK' : 'MISMATCH'}`);
  if (!ok) process.exitCode = 1;
}
```

`scripts/create-owner.ts`:

```ts
// Creates the first owner login. Every other user is created by the owner in the app.
import { createAdminClient } from '@/lib/supabase/admin';

const [email, fullName] = process.argv.slice(2);
const password = process.env.OWNER_PASSWORD;
if (!email || !fullName || !password || password.length < 8) {
  console.error('usage: read -rs OWNER_PASSWORD && export OWNER_PASSWORD && npm run create-owner -- owner@example.com "Full Name"');
  console.error('(the password must be at least 8 characters)');
  process.exit(1);
}

const db = createAdminClient();
const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error || !data.user) throw new Error(`could not create the login: ${error?.message}`);
const { error: profileError } = await db
  .from('profiles')
  .insert({ user_id: data.user.id, email: email.toLowerCase(), full_name: fullName, role: 'owner' });
if (profileError) {
  await db.auth.admin.deleteUser(data.user.id);
  throw new Error(`could not create the owner profile: ${profileError.message}`);
}
console.log(`Owner account created for ${email}. Start the app and sign in at /login.`);
```

- [ ] **Step 6: Try dump and extract on a made-up workbook**

```bash
FAKE=$(mktemp -d)
node --input-type=module -e "
import ExcelJS from 'exceljs';
const wb = new ExcelJS.Workbook();
for (const [n, a] of [['Ansari Enterprise', 1330193], ['Briks SVG Site', 4869385]]) {
  const s = wb.addWorksheet(n); s.addRow([n]); s.addRow(['Opening outstanding', a]); s.addRow(['Date', 'Payment']);
}
await wb.xlsx.writeFile('$FAKE/Fake_Outstanding.xlsx');"
npm run -s openings:dump -- $FAKE/Fake_Outstanding.xlsx | head -4
npm run -s openings:extract -- $FAKE/Fake_Outstanding.xlsx JI
npm run -s openings:extract -- $FAKE/Fake_Outstanding.xlsx JI
git status --short data
```

Expected: the dump shows `A2="Opening outstanding"  B2=1330193`; the first extract prints `2 vendors, total ₹61,99,578.00; statements say ₹61,99,578.00.`; the second refuses with `already exists and may hold your edits`; `git status` shows nothing under `data/`. Then delete the fake review sheet: `rm data/private/openings-JI.xlsx`.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run typecheck`
Expected: `Test Files  17 passed (17)`, `Tests  101 passed (101)`, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/openings tests/openings scripts
git commit -m "feat: add opening-balance extract, review and import tools"
```

---

### Task 10: Create the Supabase project and sign in for real

Steps 1–3 and 7–9 need the owner (their Supabase account, their password). Nothing in this task may put a key or password into git.

**Files:**
- Create: `.env.local` (git-ignored), `supabase/config.toml`, `supabase/.gitignore`

- [ ] **Step 1: Create the project**

On supabase.com: New project → name `construction-ledger`, region **South Asia (Mumbai)**, a strong database password (save it in a password manager). The free plan is enough while building.

- [ ] **Step 2: Switch off self sign-up**

Authentication → Sign In / Providers: turn **off** "Allow new users to sign up"; keep the Email provider on. Accounts are created only by the owner (the app confirms their email automatically).

- [ ] **Step 3: Put the keys in `.env.local`**

```bash
cp .env.example .env.local
```

Fill in from Project Settings → API Keys: the project URL, the **publishable** key and the **secret** key. Check: `git status` must not list `.env.local`.

- [ ] **Step 4: Link the repository to the project**

```bash
npx supabase init          # creates supabase/config.toml; answer "N" to the optional prompts
npx supabase login         # opens the browser
npx supabase link --project-ref <the ref in your project URL>   # asks for the database password
```

- [ ] **Step 5: Apply the migrations**

Run: `npm run db:push` and confirm with `Y`.
Expected: it lists all 9 migration files (5 from Plan 1, 4 from this plan) and ends with `Finished supabase db push.`

- [ ] **Step 6: Commit the Supabase CLI settings**

```bash
git status --short          # must show only supabase/config.toml and supabase/.gitignore as new
git add supabase/config.toml supabase/.gitignore
git commit -m "chore: link the Supabase project"
```

- [ ] **Step 7: Create the owner's login**

```bash
read -rs OWNER_PASSWORD && export OWNER_PASSWORD
npm run create-owner -- you@example.com "Your Name"
unset OWNER_PASSWORD
```

Expected: `Owner account created for you@example.com.`

- [ ] **Step 8: Sign in and set up the masters**

Run `npm run dev`, open http://localhost:3000, sign in. Under Masters add: firms `JI` Jayraj Infra and `AB` A B Infra; the sites; the clients (Parties, type Client); each firm's bank accounts, `Owner cash`, and one supervisor-cash account per supervisor; the work orders (with TDS/retention %).

- [ ] **Step 9: Check the permissions by hand**

Under Users, create an office user assigned to `AB` and a supervisor assigned to one site (then set them as holder of their supervisor-cash account). In a private window, sign in as each and confirm:

| Check | Expected |
|---|---|
| Office: Masters → Firms / Sites / Work orders | Read-only ("Only the owner can change these"); only AB's work orders listed |
| Office: Masters → Parties | Can add and edit |
| Office: open `/users` or `/history` | Sent back to Home |
| Supervisor: menu | Only Home and Settings |
| Anyone: Settings → हिन्दी | Screens switch to Hindi, and stay Hindi after signing in again |
| Owner: Change history | Shows the masters and users created above, by the owner |

---

### Task 11: Import the opening balances

Needs `AB_Infra_Outstanding.xlsx` and `Jayraj_Infra_Outstanding.xlsx`. **These files and the review sheets must never be committed** (public repository).

- [ ] **Step 1: Put the workbooks in the private folder**

Copy both files into `data/private/`. Check: `git status --short` lists nothing under `data/`.

- [ ] **Step 2: Check the real layout**

Run: `npm run -s openings:dump -- data/private/Jayraj_Infra_Outstanding.xlsx | less` (and the same for AB).
If it is not "one sheet per vendor with an opening/outstanding label next to the amount", change `extractVendorOpenings` in `src/lib/openings/openings.ts` and the `outstandingWorkbook` fixture in `tests/openings/openings.test.ts` to the real layout (made-up names and amounts in the fixture, never real ones). Keep the function's output the same. Run `npx vitest run tests/openings`, then commit only those two files:

```bash
git add src/lib/openings/openings.ts tests/openings/openings.test.ts
git commit -m "fix: read the outstanding workbooks' real layout"
```

- [ ] **Step 3: Extract both firms**

```bash
npm run openings:extract -- data/private/Jayraj_Infra_Outstanding.xlsx JI
npm run openings:extract -- data/private/AB_Infra_Outstanding.xlsx AB
```

Expected: 24 vendors for JI and 9 for AB, each total matching its statement total.

- [ ] **Step 4: The owner reviews both sheets**

In `data/private/openings-JI.xlsx` and `openings-AB.xlsx`:
- Clean the `name` column to the real supplier (e.g. "Briks SVG Site" → the brick supplier's name). Leave `source` as it is: it is saved as the entry's reference.
- Spell shared vendors identically in both files (e.g. Ansari Enterprise, Shree Ambika Marketing) so they become one party with a balance per firm.
- Add a `money` row (firm empty) for each bank, owner-cash and supervisor-cash balance on 21-Oct-2026, using the exact account names from Masters.
- Add a `client` row (firm code, work order number in `name`) for any amount a client owed on that date; negative = an advance received.

- [ ] **Step 5: Import**

Run: `npm run openings:import -- data/private/openings-JI.xlsx data/private/openings-AB.xlsx`
Expected: `Posted N opening entries; 0 were already posted.`, then `JI: owed to vendors ₹61,99,578.00, statements ₹61,99,578.00 OK` and `AB: owed to vendors ₹16,71,606.00, statements ₹16,71,606.00 OK`.

- [ ] **Step 6: Prove it is safe to run twice**

Run the same command again.
Expected: `Posted 0 opening entries; N were already posted.` and both `OK` lines.

- [ ] **Step 7: Nothing to commit**

`git status --short` must show no changes. The imported data lives in Supabase only.

---

### Task 12: Full check, project notes, push

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: Run everything**

Run: `npm test && npm run typecheck && npm run build`
Expected: `Test Files  17 passed (17)`, `Tests  101 passed (101)`, no type errors, build succeeds (it reads `.env.local`).

- [ ] **Step 2: Update `CLAUDE.md`**

Replace the "Build plan" and "Next step" bullets with Plan 2 done / write Plan 3, and extend the Commands section:

```markdown
- `npm run dev`: the app at http://localhost:3000 (needs `.env.local`, see `.env.example`)
- `npm run db:push`: apply new migrations to the linked Supabase project
- `npm run create-owner`, `npm run openings:dump|extract|import`: one-time setup scripts (see Plan 2)
- Every new table needs `enable row level security`, policies and explicit grants (defaults are revoked). App writes to the ledger only through the `app_*` functions.
- Real business data stays in `data/private/` and `.env.local` (git-ignored). The repository is public.
```

- [ ] **Step 3: Add setup to `README.md`**

Under the existing new-computer section add:

```markdown
Then, to run the app:

    npm install
    cp .env.example .env.local   # fill in from Supabase → Project Settings → API Keys
    npm run dev                  # http://localhost:3000

No Docker needed. Tests (`npm test`) use an in-process database.
```

- [ ] **Step 4: Commit and push the branch**

```bash
git add CLAUDE.md README.md
git commit -m "docs: add app setup and Plan 2 status"
git push -u origin feat/app-shell
```

Expected: the hooks pass and the branch appears on GitHub.

- [ ] **Step 5: Finish the branch**

Use superpowers:finishing-a-development-branch (or ask the owner) to merge `feat/app-shell` into `main`.
