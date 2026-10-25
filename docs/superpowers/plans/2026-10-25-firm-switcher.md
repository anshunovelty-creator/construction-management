# Firm Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A button at the top right sets each person's working firm (AB Infra or Jayraj Infra). Every screen then shows only that firm, and every new entry is made for it, without asking for the firm or signing in again.

**Architecture:**
- **Storage:** the choice is kept per person in a new `working_firms` table, written only through a checked `app_set_my_firm` function. It has no audit trigger, so switching leaves nothing in the change log.
- **Reading:** one cached server helper, `getWorkingFirm()`, works out the person's allowed firms and their working firm once per request. Pages read it instead of `?firm=`.
- **Saving:** entry forms get the firm bound into their save action when the page is rendered, so a form saves for the firm it was opened in. Pure, tested rules in `src/lib/firm.ts` decide which money accounts each list offers and what the server refuses on save.
- **Day book:** it lists the firm's entries plus Common ones (no firm on any line).

**Tech stack:** unchanged. Next.js 16.4.2, React 19.3.1, @supabase/supabase-js 2.118.0, @supabase/ssr 0.12.7, next-intl 4.14.9, TypeScript 7.0.2, Vitest 5.0.5, PGlite 0.5.11.

**Spec:** `docs/superpowers/specs/2026-10-25-firm-switcher-design.md`

**Pre-validated:** every change in this plan was built and run in a scratch copy of the repo (from commit `305db31`) before the plan was written:
- `npm test`: `Test Files 23 passed (23)`, `Tests 129 passed (129)` (110 before, plus 19 new).
- `npm run typecheck`: no errors.
- `next build`: compiles all 19 routes.

The running app was not checked against the cloud database; Task 9 does that.

---

## Conventions (read before starting)

- Everything in Plans 1 and 2's conventions still holds. In particular:
  - Who can do what lives in the database.
  - Every new table enables row level security and grants exactly what the API needs. Default privileges are revoked, and a test fails if any table lacks row level security.
  - Ledger tables are append-only.
- **Git:** work on branch `feat/firm-switcher`, made from `main`.
  - Commit as yourself (`git config user.email` must be `anshu.novelty@gmail.com`).
  - The repo hooks reject any Claude/Anthropic author or `Co-Authored-By` line. Never pass `--no-verify`.
- Run every command from the repository root. `npm test`, `npm run typecheck` and `npm run build` work in PowerShell and Git Bash alike.
- **Test counts:** the suite starts at `Test Files 21 passed (21)`, `Tests 110 passed (110)`. Each task says what it should be afterwards.
- Edits are given as **"Replace … with …"**. The text to replace appears exactly once in the file, unless a step says otherwise.

### Decisions recorded here

1. **The firm travels with the save action, not a hidden form field.** Pages bind the working firm's id into `postEntryForm` / `postEntryRows` / `postPartyRows` when they render. The server re-checks it against the person's allowed firms, and the database checks again in `app_post_entry`.
2. **Account lists are chosen by the field's source.** `moneyAccounts` means the working firm's banks plus common cash. `moneyAccountsWeOwe` (pay vendor's "Paid from") and `moneyAccountsTheyOwe` (client receipt's "Received into", move money's "To") also add the other firm's banks, grouped under a label naming the due. Setup screens load lists without a firm and see everything, as before.
3. **`getWorkingFirm()` lives in `src/lib/auth.ts`**, next to `getProfile()`. The pure rules it uses live in `src/lib/firm.ts`, so they can be tested without Next.js.
4. **A firm's entries in the day book** are those with a line for the firm (as `?firm=` did before). **Common entries** are CM-series entries whose lines name no firm. A firm's bill paid from owner cash is CM-series but has a firm line, so it isn't Common.
5. **Overview stays a whole-books board** until the three-way reports are built (spec section 2).

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261025120000_working_firm.sql` (new) | `working_firms` table, row level security, `app_set_my_firm` |
| `tests/db/working-firm.test.ts` (new) | Who may switch to what; own row only; nothing in the change log |
| `src/lib/firm.ts` (new) | Pure rules: allowed firms, fallback, account lists and scope, save checks, Common entries |
| `tests/firm/firm.test.ts` (new) | Tests for those rules |
| `src/lib/auth.ts` | `getWorkingFirm()`: the working firm per request |
| `src/lib/masters/registry.ts` | `Choice` type, new list sources, entry forms without a firm field, `FIRM_FORMS` |
| `src/app/(app)/masters/options.ts` | Lists narrowed to the working firm (work orders, money accounts) |
| `src/components/choice-options.tsx` (new) | Dropdown options with `<optgroup>`s |
| `src/components/form.tsx`, `src/components/entry-sheet.tsx` | Use the grouped options |
| `src/app/(app)/firm/actions.ts` (new) | `switchFirm` server action |
| `src/components/firm-switch.tsx` (new) | The top-right button and menu |
| `src/app/(app)/layout.tsx`, `src/app/globals.css` | Show the switcher; its styles, the "For …" line and the Common tag |
| `src/components/firm-line.tsx` (new) | "For AB Infra" / "Working in AB Infra" above a form |
| `src/app/(app)/entries/actions.ts` | Save for the bound firm; firm checks before posting |
| `src/app/(app)/entries/new/[slug]/page.tsx`, `entries/sheet/page.tsx` | Forms and sheet in the working firm |
| `src/app/(app)/party/shared.tsx`, `page.tsx`, `dashboard/page.tsx`, `clients/page.tsx`, `party/page.tsx`, `client/page.tsx` | Firm pages read the working firm; `FirmTabs` removed |
| `src/app/(app)/entries/page.tsx`, `src/components/board.tsx` | Day book in the working firm plus Common entries |
| `src/app/(app)/overview/page.tsx` | Per-firm links removed |
| `messages/en.json`, `messages/hi.json` | New words; unused firm-picker words removed |

---

### Task 1: The working firm table and switch function

**Files:**
- Create: `supabase/migrations/20261025120000_working_firm.sql`
- Test: `tests/db/working-firm.test.ts`

- [ ] **Step 1: Make the branch**

```bash
git checkout main
git pull
git checkout -b feat/firm-switcher
```

- [ ] **Step 2: Write the failing test**

Create `tests/db/working-firm.test.ts`:

```ts
import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asUser, createMigratedDb, createUser, seedBasics, type Seed } from './harness';

let template: PGlite;
let db: PGliteInterface;
let seed: Seed;
let owner: string;
let office: string; // assigned to A B Infra only
let supervisor: string;

const switchTo = (userId: string, firmId: string) =>
  asUser(db, userId, (tx) => tx.query('select app_set_my_firm($1)', [firmId]));

const savedFirm = async (userId: string) =>
  (await db.query<{ firm_id: string }>('select firm_id from working_firms where user_id = $1', [userId])).rows[0]?.firm_id;

beforeAll(async () => {
  template = await createMigratedDb();
});

beforeEach(async () => {
  db = await template.clone();
  seed = await seedBasics(db);
  owner = await createUser(db, 'owner', 'Owner');
  office = await createUser(db, 'office', 'Priya', { firms: [seed.ab] });
  supervisor = await createUser(db, 'supervisor', 'Ramesh', { sites: [seed.svgSite] });
});

describe('working firm', () => {
  it('lets the owner switch to either firm, keeping one row', async () => {
    await switchTo(owner, seed.ab);
    expect(await savedFirm(owner)).toBe(seed.ab);
    await switchTo(owner, seed.jayraj);
    expect(await savedFirm(owner)).toBe(seed.jayraj);
    const { rows } = await db.query('select count(*)::int as n from working_firms where user_id = $1', [owner]);
    expect(rows).toEqual([{ n: 1 }]);
  });

  it('lets office staff switch only to their assigned firms', async () => {
    await switchTo(office, seed.ab);
    expect(await savedFirm(office)).toBe(seed.ab);
    await expect(switchTo(office, seed.jayraj)).rejects.toThrow('not assigned to this firm');
    expect(await savedFirm(office)).toBe(seed.ab);
  });

  it('refuses supervisors and deactivated users', async () => {
    await expect(switchTo(supervisor, seed.ab)).rejects.toThrow('not assigned to this firm');
    await db.query('update profiles set is_active = false where user_id = $1', [office]);
    await expect(switchTo(office, seed.ab)).rejects.toThrow('deactivated');
  });

  it('shows each person only their own choice and allows no direct writes', async () => {
    await switchTo(owner, seed.jayraj);
    await switchTo(office, seed.ab);
    const seen = await asUser(db, office, (tx) => tx.query('select user_id, firm_id from working_firms'));
    expect(seen.rows).toEqual([{ user_id: office, firm_id: seed.ab }]);
    await expect(
      asUser(db, office, (tx) => tx.query('update working_firms set firm_id = $1 where user_id = $2', [seed.jayraj, office])),
    ).rejects.toThrow('permission denied');
  });

  it('leaves nothing in the change log', async () => {
    const before = await db.query('select count(*)::int as n from master_changes');
    await switchTo(owner, seed.ab);
    await switchTo(owner, seed.jayraj);
    expect((await db.query('select count(*)::int as n from master_changes')).rows).toEqual(before.rows);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run tests/db/working-firm.test.ts`
Expected: `5 failed`, with errors like `function app_set_my_firm(unknown) does not exist`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20261025120000_working_firm.sql`:

```sql
-- The firm each person is working in: the switcher at the top right of the app.
-- A preference, not master data, so it has no audit trigger: switching back and forth
-- leaves nothing in the change log.

create table working_firms (
  user_id uuid primary key references profiles (user_id),
  firm_id uuid not null references firms (id),
  updated_at timestamptz not null default now()
);

-- Everyone reads only their own choice. Changes go only through app_set_my_firm.
alter table working_firms enable row level security;
create policy working_firms_read on working_firms for select to authenticated using (user_id = auth.uid());
grant select on working_firms to authenticated;

-- Owner: any firm. Office staff: their assigned firms. Supervisors work at sites, not in a firm.
create function app_set_my_firm(p_firm_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if app_my_role() is null then
    raise exception 'not signed in, or this account is deactivated';
  end if;
  if not app_has_firm(p_firm_id) then
    raise exception 'you are not assigned to this firm';
  end if;
  insert into working_firms (user_id, firm_id) values (auth.uid(), p_firm_id)
  on conflict (user_id) do update set firm_id = excluded.firm_id, updated_at = now();
end $$;

grant execute on function app_set_my_firm(uuid) to authenticated;
```

- [ ] **Step 5: Run the database tests**

Run: `npx vitest run tests/db`
Expected: `Test Files 10 passed (10)`, `Tests 54 passed (54)`. This includes the existing check that every table has row level security.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261025120000_working_firm.sql tests/db/working-firm.test.ts
git commit -m "feat: store each person's working firm, switched through a checked function"
```

---

### Task 2: The firm rules

**Files:**
- Create: `src/lib/firm.ts`
- Modify: `src/lib/masters/registry.ts`, `src/app/(app)/masters/options.ts`
- Test: `tests/firm/firm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/firm/firm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { accountChoices, accountScope, allowedFirms, inScope, isCommonEntry, pickWorkingFirm, type AccountRow } from '@/lib/firm';
import { cashTransfer, siteCashExpense } from '@/lib/ledger/posting/cash';
import { vendorPayment } from '@/lib/ledger/posting/vendor';
import type { EntryDraft } from '@/lib/ledger/types';
import { AB, AB_BANK, JI, JI_BANK, OWNER_CASH, RAMESH, SVG, VENDOR } from '../ledger/fixtures';

const ab = { id: AB, name: 'AB Infra' };
const ji = { id: JI, name: 'Jayraj Infra' };

describe('allowedFirms', () => {
  it('gives the owner every firm, office staff their assigned ones and supervisors none', () => {
    expect(allowedFirms('owner', [ab, ji], [])).toEqual([ab, ji]);
    expect(allowedFirms('office', [ab, ji], [JI])).toEqual([ji]);
    expect(allowedFirms('office', [ab, ji], [])).toEqual([]);
    expect(allowedFirms('supervisor', [ab, ji], [AB])).toEqual([]);
  });
});

describe('pickWorkingFirm', () => {
  it('uses the saved firm while it is allowed', () => {
    expect(pickWorkingFirm([ab, ji], JI)).toEqual(ji);
  });

  it('falls back to the first allowed firm when nothing is saved or the saved one was taken away', () => {
    expect(pickWorkingFirm([ab, ji], null)).toEqual(ab);
    expect(pickWorkingFirm([ji], AB)).toEqual(ji);
    expect(pickWorkingFirm([], AB)).toBeUndefined();
  });
});

describe('money account lists', () => {
  const rows: AccountRow[] = [
    { id: AB_BANK.id, name: 'AB Infra - Bank', firm_id: AB },
    { id: JI_BANK.id, name: 'Jayraj Infra - Bank', firm_id: JI },
    { id: OWNER_CASH.id, name: 'Owner cash', firm_id: null },
  ];
  const groupOf = (otherFirmId: string) => `Other firm: ${otherFirmId}`;

  it('reads the scope from the field source', () => {
    expect(accountScope('moneyAccounts')).toBe('own');
    expect(accountScope('moneyAccountsWeOwe')).toBe('weOwe');
    expect(accountScope('moneyAccountsTheyOwe')).toBe('theyOwe');
    expect(accountScope('vendors')).toBeUndefined();
  });

  it('lists only the firm’s own banks and common cash where money may not cross', () => {
    expect(accountChoices(rows, 'own', AB, groupOf)).toEqual([
      { value: AB_BANK.id, label: 'AB Infra - Bank' },
      { value: OWNER_CASH.id, label: 'Owner cash' },
    ]);
  });

  it('adds the other firm’s banks last, in their own group, where money may cross', () => {
    expect(accountChoices(rows, 'weOwe', AB, groupOf)).toEqual([
      { value: AB_BANK.id, label: 'AB Infra - Bank' },
      { value: OWNER_CASH.id, label: 'Owner cash' },
      { value: JI_BANK.id, label: 'Jayraj Infra - Bank', group: `Other firm: ${JI}` },
    ]);
  });

  it('checks a chosen account the same way on save', () => {
    expect(inScope('own', null, AB)).toBe(true);
    expect(inScope('own', AB, AB)).toBe(true);
    expect(inScope('own', JI, AB)).toBe(false);
    expect(inScope('weOwe', JI, AB)).toBe(true);
    expect(inScope('theyOwe', JI, AB)).toBe(true);
  });
});

describe('isCommonEntry', () => {
  const rowsOf = (draft: EntryDraft) => draft.lines.map((l) => ({ firm_id: l.firmId ?? null }));

  it('is true when no line names a firm, like cash handed to a supervisor or a supervisor’s spend', () => {
    const handOver = cashTransfer({ from: OWNER_CASH, to: RAMESH, amountPaise: 500_000, transferDate: '2026-10-22' });
    const spend = siteCashExpense({
      from: RAMESH, siteId: SVG, costHead: 'labour', amountPaise: 50_000, expenseDate: '2026-10-22', narration: 'helpers',
    });
    expect(isCommonEntry(rowsOf(handOver))).toBe(true);
    expect(isCommonEntry(rowsOf(spend))).toBe(true);
  });

  it('is false for a firm’s bill paid from owner cash, though its serial is CM', () => {
    const payment = vendorPayment({ billFirmId: AB, vendorId: VENDOR, from: OWNER_CASH, amountPaise: 100_000, paymentDate: '2026-10-22' });
    expect(payment.firmId).toBeNull();
    expect(isCommonEntry(rowsOf(payment))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/firm`
Expected: FAIL with `Cannot find package '@/lib/firm'`.

- [ ] **Step 3: Add the choice type and the new list sources to the registry**

In `src/lib/masters/registry.ts`, replace:

```ts
/** Where a reference field's choices come from. */
export type RefSource = 'firms' | 'sites' | 'clients' | 'supervisors' | 'vendors' | 'parties' | 'moneyAccounts' | 'workOrders' | 'materials';
```

with:

```ts
/**
 * Where a reference field's choices come from. In a working firm, `moneyAccounts` lists that firm's banks
 * and common cash; the `WeOwe` / `TheyOwe` lists add the other firms' banks, for forms where money may cross.
 */
export type RefSource =
  | 'firms' | 'sites' | 'clients' | 'supervisors' | 'vendors' | 'parties' | 'workOrders' | 'materials'
  | 'moneyAccounts' | 'moneyAccountsWeOwe' | 'moneyAccountsTheyOwe';

/** One choice in a dropdown. Choices with a `group` come last, under that heading. */
export type Choice = { value: string; label: string; group?: string };
```

- [ ] **Step 4: Let the list loader accept the new sources**

In `src/app/(app)/masters/options.ts`, replace:

```ts
    case 'moneyAccounts': {
```

with:

```ts
    case 'moneyAccounts':
    case 'moneyAccountsWeOwe':
    case 'moneyAccountsTheyOwe': {
```

(Task 3 narrows these lists to the working firm.)

- [ ] **Step 5: Write the rules**

Create `src/lib/firm.ts`:

```ts
import type { AppRole } from '@/lib/auth';
import type { Choice, RefSource } from '@/lib/masters/registry';

export type Firm = { id: string; name: string };

/** The firms someone may work in: the owner every firm, office staff their assigned ones, supervisors none. */
export function allowedFirms(role: AppRole, firms: Firm[], assignedFirmIds: string[]): Firm[] {
  if (role === 'owner') return firms;
  if (role === 'office') return firms.filter((f) => assignedFirmIds.includes(f.id));
  return [];
}

/** The saved firm while it is still allowed, else the first allowed one. */
export function pickWorkingFirm(allowed: Firm[], savedId: string | null | undefined): Firm | undefined {
  return allowed.find((f) => f.id === savedId) ?? allowed[0];
}

/**
 * Which money accounts a list offers in a working firm: `own` is the firm's banks and common cash;
 * `weOwe` / `theyOwe` add the other firms' banks, where using them leaves a between-firm due.
 */
export type AccountScope = 'own' | 'weOwe' | 'theyOwe';

const SCOPES: Partial<Record<RefSource, AccountScope>> = {
  moneyAccounts: 'own',
  moneyAccountsWeOwe: 'weOwe',
  moneyAccountsTheyOwe: 'theyOwe',
};

/** The account scope of a reference field's source; undefined when it is not a money account list. */
export const accountScope = (source: RefSource): AccountScope | undefined => SCOPES[source];

/** Whether an account (by its firm; null = common cash) is in a list for the working firm. */
export const inScope = (scope: AccountScope, accountFirmId: string | null, firmId: string): boolean =>
  accountFirmId === null || accountFirmId === firmId || scope !== 'own';

export type AccountRow = { id: string; name: string; firm_id: string | null };

/** A money account list in the working firm: its own banks and common cash, then any other firm's banks under `groupOf`. */
export function accountChoices(rows: AccountRow[], scope: AccountScope, firmId: string, groupOf: (otherFirmId: string) => string): Choice[] {
  const own = rows.filter((r) => r.firm_id === null || r.firm_id === firmId).map((r) => ({ value: r.id, label: r.name }));
  if (scope === 'own') return own;
  const other = rows
    .filter((r) => r.firm_id !== null && r.firm_id !== firmId)
    .map((r) => ({ value: r.id, label: r.name, group: groupOf(r.firm_id!) }));
  return [...own, ...other];
}

/** An entry that belongs to no firm: none of its lines names one (cash between the owner and supervisors, a supervisor's spend). */
export const isCommonEntry = (lines: { firm_id: string | null }[]): boolean => lines.every((l) => l.firm_id === null);
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run tests/firm`
Expected: `Tests 9 passed (9)`.

Run: `npm run typecheck`
Expected: no output.

Run: `npm test`
Expected: `Test Files 23 passed (23)`, `Tests 124 passed (124)`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/firm.ts tests/firm/firm.test.ts src/lib/masters/registry.ts "src/app/(app)/masters/options.ts"
git commit -m "feat: add the working firm rules: allowed firms, fallback, account lists, common entries"
```

---

### Task 3: Read the working firm, and narrow the lists to it

**Files:**
- Create: `src/components/choice-options.tsx`
- Modify: `src/lib/auth.ts`, `src/app/(app)/masters/options.ts`, `src/components/form.tsx`, `src/components/entry-sheet.tsx`, `messages/en.json`, `messages/hi.json`

- [ ] **Step 1: Add `getWorkingFirm()`**

In `src/lib/auth.ts`, replace:

```ts
import type { Locale } from '@/i18n/locale';
import { createClient } from '@/lib/supabase/server';
```

with:

```ts
import type { Locale } from '@/i18n/locale';
import { allowedFirms, pickWorkingFirm, type Firm } from '@/lib/firm';
import { createClient } from '@/lib/supabase/server';
```

Then replace:

```ts
/** Sends signed-out users to /login, and users without one of `roles` to the home page. */
```

with:

```ts
export interface WorkingFirm {
  /** The firms this person may work in, A to Z. */
  firms: Firm[];
  /** The one they are working in now. */
  firm: Firm;
}

/**
 * The firm the signed-in user is working in (the switcher at the top right), and the firms they may switch to.
 * Null for supervisors and for office staff with no firm assigned. One lookup per request.
 */
export const getWorkingFirm = cache(async (): Promise<WorkingFirm | null> => {
  const profile = await getProfile();
  if (!profile || profile.role === 'supervisor') return null;
  const db = await createClient();
  const [{ data: firms }, { data: assigned }, { data: saved }] = await Promise.all([
    db.from('firms').select('id, name').order('name').returns<Firm[]>(),
    db.from('user_firms').select('firm_id').eq('user_id', profile.user_id),
    db.from('working_firms').select('firm_id').eq('user_id', profile.user_id).maybeSingle(),
  ]);
  const allowed = allowedFirms(profile.role, firms ?? [], (assigned ?? []).map((r) => r.firm_id as string));
  const firm = pickWorkingFirm(allowed, saved?.firm_id as string | undefined);
  return firm ? { firms: allowed, firm } : null;
});

/** Sends signed-out users to /login, and users without one of `roles` to the home page. */
```

- [ ] **Step 2: Narrow the lists in the loader**

In `src/app/(app)/masters/options.ts`, replace:

```ts
import type { Choices } from '@/components/form';
import type { Field, RefSource } from '@/lib/masters/registry';
import { showPaise } from '@/lib/money';
import type { createClient } from '@/lib/supabase/server';
import { showDate } from '../entries/data';

type Db = Awaited<ReturnType<typeof createClient>>;
type Choice = { value: string; label: string };

async function load(db: Db, source: RefSource): Promise<Choice[]> {
  switch (source) {
```

with:

```ts
import type { getTranslations } from 'next-intl/server';
import type { Choices } from '@/components/form';
import type { WorkingFirm } from '@/lib/auth';
import { accountChoices, accountScope, type AccountRow } from '@/lib/firm';
import type { Choice, Field, RefSource } from '@/lib/masters/registry';
import { showPaise } from '@/lib/money';
import type { createClient } from '@/lib/supabase/server';
import { showDate } from '../entries/data';

type Db = Awaited<ReturnType<typeof createClient>>;
type T = Awaited<ReturnType<typeof getTranslations>>;

/** Narrows entry form lists to the working firm. Setup screens load without it and list everything. */
export interface ChoiceScope {
  working: WorkingFirm;
  t: T;
}

async function load(db: Db, source: RefSource, scope?: ChoiceScope): Promise<Choice[]> {
  switch (source) {
```

Then replace:

```ts
    case 'moneyAccounts':
    case 'moneyAccountsWeOwe':
    case 'moneyAccountsTheyOwe': {
      const { data } = await db.from('money_accounts').select('id, name').eq('is_active', true).order('name');
      return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
    }
    case 'workOrders': {
      const { data } = await db
        .from('work_orders')
        .select('id, ref, client:parties!client_id(name), site:sites(name)')
        .eq('is_active', true)
        .order('ref')
        .returns<{ id: string; ref: string; client: { name: string } | null; site: { name: string } | null }[]>();
      return (data ?? []).map((r) => ({ value: r.id, label: `${r.ref} · ${r.client?.name} · ${r.site?.name}` }));
    }
  }
}

/** Choices for every reference field in `fields`, as the signed-in user may see them. */
export async function loadChoices(db: Db, fields: Field[]): Promise<Choices> {
  const sources = [...new Set(fields.flatMap((f) => (f.kind === 'ref' || f.kind === 'multi' ? [f.ref] : [])))];
  const loaded = await Promise.all(sources.map((source) => load(db, source)));
  return Object.fromEntries(sources.map((source, i) => [source, loaded[i]]));
}
```

with:

```ts
    case 'moneyAccounts':
    case 'moneyAccountsWeOwe':
    case 'moneyAccountsTheyOwe': {
      const { data } = await db
        .from('money_accounts')
        .select('id, name, firm_id')
        .eq('is_active', true)
        .order('name')
        .returns<AccountRow[]>();
      if (!scope) return (data ?? []).map((r) => ({ value: r.id, label: r.name }));
      const { firm, firms } = scope.working;
      const nameOf = (id: string) => firms.find((f) => f.id === id)?.name ?? '';
      // "Other firm: AB Infra will owe Jayraj Infra": the due that picking one of these accounts leaves behind.
      const groupOf = (other: string) =>
        scope.t(source === 'moneyAccountsWeOwe' ? 'firm.otherWeOwe' : 'firm.otherTheyOwe', { us: firm.name, them: nameOf(other) });
      return accountChoices(data ?? [], accountScope(source)!, firm.id, groupOf);
    }
    case 'workOrders': {
      let query = db
        .from('work_orders')
        .select('id, ref, client:parties!client_id(name), site:sites(name)')
        .eq('is_active', true);
      if (scope) query = query.eq('firm_id', scope.working.firm.id);
      const { data } = await query
        .order('ref')
        .returns<{ id: string; ref: string; client: { name: string } | null; site: { name: string } | null }[]>();
      return (data ?? []).map((r) => ({ value: r.id, label: `${r.ref} · ${r.client?.name} · ${r.site?.name}` }));
    }
  }
}

/** Choices for every reference field in `fields`, as the signed-in user may see them; in `scope`'s firm when given. */
export async function loadChoices(db: Db, fields: Field[], scope?: ChoiceScope): Promise<Choices> {
  const sources = [...new Set(fields.flatMap((f) => (f.kind === 'ref' || f.kind === 'multi' ? [f.ref] : [])))];
  const loaded = await Promise.all(sources.map((source) => load(db, source, scope)));
  return Object.fromEntries(sources.map((source, i) => [source, loaded[i]]));
}
```

- [ ] **Step 3: Draw grouped dropdown options**

Create `src/components/choice-options.tsx`:

```tsx
import type { Choice } from '@/lib/masters/registry';

/** The <option>s of a dropdown: ungrouped choices first, then one <optgroup> per group, in the order they appear. */
export function ChoiceOptions({ choices }: { choices: Choice[] }) {
  const groups = [...new Set(choices.flatMap((c) => (c.group ? [c.group] : [])))];
  const option = (c: Choice) => <option key={c.value} value={c.value}>{c.label}</option>;
  return (
    <>
      {choices.filter((c) => !c.group).map(option)}
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {choices.filter((c) => c.group === group).map(option)}
        </optgroup>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Use them in the form**

In `src/components/form.tsx`, replace:

```ts
import { useActionState } from 'react';
import { ENUMS, type Field, type RefSource } from '@/lib/masters/registry';
```

with:

```ts
import { useActionState } from 'react';
import { ChoiceOptions } from '@/components/choice-options';
import { ENUMS, type Choice, type Field, type RefSource } from '@/lib/masters/registry';
```

Replace:

```ts
export type Choices = Partial<Record<RefSource, { value: string; label: string }[]>>;
```

with:

```ts
export type Choices = Partial<Record<RefSource, Choice[]>>;
```

Replace:

```tsx
                    : (choices[field.ref] ?? []).map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
```

with:

```tsx
                    : <ChoiceOptions choices={choices[field.ref] ?? []} />}
```

- [ ] **Step 5: Use them in the entry sheet**

In `src/components/entry-sheet.tsx`, replace:

```ts
import type { FormState } from '@/components/form';

export interface Column {
  name: string;
  label: string;
  hint?: string;
  kind: 'text' | 'rupees' | 'date' | 'select';
  required: boolean;
  options?: { value: string; label: string }[];
}
```

with:

```ts
import { ChoiceOptions } from '@/components/choice-options';
import type { FormState } from '@/components/form';
import type { Choice } from '@/lib/masters/registry';

export interface Column {
  name: string;
  label: string;
  hint?: string;
  kind: 'text' | 'rupees' | 'date' | 'select';
  required: boolean;
  options?: Choice[];
}
```

Replace:

```tsx
                            <option value="" />
                            {col.options?.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
```

with:

```tsx
                            <option value="" />
                            <ChoiceOptions choices={col.options ?? []} />
```

- [ ] **Step 6: Add the words**

At the end of `messages/en.json`, replace:

```json
    "needWorkOrder": "This client has no work order for this firm yet. A work order says which site the bills are for."
  }
}
```

with:

```json
    "needWorkOrder": "This client has no work order for this firm yet. A work order says which site the bills are for."
  },
  "firm": {
    "switchLabel": "Working in {firm}. Tap to switch firm.",
    "menuTitle": "Work in",
    "switchFailed": "Could not switch firm. Try again.",
    "for": "For {firm}",
    "workingIn": "Working in {firm}",
    "otherWeOwe": "Other firm: {us} will owe {them}",
    "otherTheyOwe": "Other firm: {them} will owe {us}",
    "common": "Common",
    "commonHint": "Owner or supervisor cash: belongs to no firm."
  }
}
```

At the end of `messages/hi.json`, replace:

```json
    "needWorkOrder": "इस क्लाइंट का इस फर्म में अभी कोई वर्क ऑर्डर नहीं। वर्क ऑर्डर बताता है कि बिल किस साइट के हैं।"
  }
}
```

with:

```json
    "needWorkOrder": "इस क्लाइंट का इस फर्म में अभी कोई वर्क ऑर्डर नहीं। वर्क ऑर्डर बताता है कि बिल किस साइट के हैं।"
  },
  "firm": {
    "switchLabel": "अभी {firm} में काम। फर्म बदलने के लिए दबाएँ।",
    "menuTitle": "किस फर्म में काम करें",
    "switchFailed": "फर्म नहीं बदल पाई। फिर से कोशिश करें।",
    "for": "{firm} के लिए",
    "workingIn": "अभी {firm} में",
    "otherWeOwe": "दूसरी फर्म: {us} को {them} का पैसा देना होगा",
    "otherTheyOwe": "दूसरी फर्म: {them} को {us} का पैसा देना होगा",
    "common": "साझा",
    "commonHint": "मालिक या सुपरवाइज़र की नकदी: किसी फर्म की नहीं।"
  }
}
```

- [ ] **Step 7: Check**

Run: `npm run typecheck`
Expected: no output.

Run: `npm test`
Expected: `Tests 124 passed (124)`. The translation test checks that English and Hindi have the same keys.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth.ts "src/app/(app)/masters/options.ts" src/components/choice-options.tsx src/components/form.tsx src/components/entry-sheet.tsx messages/en.json messages/hi.json
git commit -m "feat: read the working firm per request and narrow entry lists to it"
```

---

### Task 4: The switcher at the top right

**Files:**
- Create: `src/app/(app)/firm/actions.ts`, `src/components/firm-switch.tsx`
- Modify: `src/app/(app)/layout.tsx`, `src/app/globals.css`

- [ ] **Step 1: The server action**

Create `src/app/(app)/firm/actions.ts`. The folder has no `page.tsx`, so it adds no route.

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export type SwitchState = { failed?: boolean };

/** Makes the chosen firm the working firm, then reloads the page the person is on. The database checks they may use it. */
export async function switchFirm(_state: SwitchState, data: FormData): Promise<SwitchState> {
  await requireProfile('owner', 'office');
  const db = await createClient();
  const { error } = await db.rpc('app_set_my_firm', { p_firm_id: String(data.get('firm') ?? '') });
  if (error) return { failed: true };
  revalidatePath('/', 'layout');
  return {};
}
```

- [ ] **Step 2: The button and menu**

Create `src/components/firm-switch.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { switchFirm } from '@/app/(app)/firm/actions';
import type { Firm } from '@/lib/firm';

/** The working firm at the top right. With more than one firm, tapping it lists them; tapping one switches. */
export function FirmSwitch({ firms, firm }: { firms: Firm[]; firm: Firm }) {
  const t = useTranslations('firm');
  const [state, action, pending] = useActionState(switchFirm, {});
  if (firms.length < 2) return <span className="firm-switch firm-name">{firm.name}</span>;
  return (
    // A new key per firm closes the menu once the switch has gone through.
    <details key={firm.id} className="more firm-switch">
      <summary className="btn ghost small" aria-label={t('switchLabel', { firm: firm.name })}>
        {firm.name} ▾
      </summary>
      <form action={action} className="more-menu card">
        <p className="eyebrow">{t('menuTitle')}</p>
        {firms.map((f) => (
          <button
            key={f.id}
            type="submit"
            name="firm"
            value={f.id}
            className="nav-link"
            aria-current={f.id === firm.id ? 'true' : undefined}
            disabled={pending}
          >
            {f.name}
          </button>
        ))}
        {state.failed && <p role="alert" className="error">{t('switchFailed')}</p>}
      </form>
    </details>
  );
}
```

- [ ] **Step 3: Show it in the top bar**

In `src/app/(app)/layout.tsx`, replace:

```tsx
import { NavLink } from '@/components/nav-link';
import { requireProfile } from '@/lib/auth';
import { signOut } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const t = await getTranslations();
```

with:

```tsx
import { FirmSwitch } from '@/components/firm-switch';
import { NavLink } from '@/components/nav-link';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { signOut } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
```

Then replace:

```tsx
          </details>
          <form action={signOut} className="signout">
```

with:

```tsx
          </details>
          {working && <FirmSwitch firms={working.firms} firm={working.firm} />}
          <form action={signOut} className="signout">
```

- [ ] **Step 4: The styles**

Add to the end of `src/app/globals.css`. This also styles the "For …" line (Task 5) and the Common tag (Task 7).

```css

/* ---------- Working firm ---------- */
/* Always in sight at the top right, so nobody types into the wrong firm's books. */
.firm-switch { margin-left: auto; }
.firm-switch + .signout { margin-left: 0; }
.firm-switch summary, .firm-name { font-weight: 600; }
.firm-name { font-size: 14px; }
.firm-switch .more-menu .eyebrow { padding: 4px 12px 2px; }
.firm-switch .more-menu button { background: none; border: 0; font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.firm-switch .more-menu button[aria-current='true'] { color: var(--ink); background: var(--paper); font-weight: 500; }
.firm-switch .more-menu .error { padding: 4px 12px; font-size: 13px; }
.firm-line { display: inline-block; margin: 0 0 12px; padding: 4px 12px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-weight: 600; font-size: 13.5px; }
.pill.common { background: var(--paper); color: var(--muted); margin-left: 8px; }
```

- [ ] **Step 5: Check**

Run: `npm run typecheck`
Expected: no output.

Run: `npm test`
Expected: `Tests 124 passed (124)`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/firm/actions.ts" src/components/firm-switch.tsx "src/app/(app)/layout.tsx" src/app/globals.css
git commit -m "feat: add the firm switcher to the top bar"
```

---

### Task 5: Entries are made for the firm their form was opened in

**Files:**
- Create: `src/components/firm-line.tsx`
- Modify: `src/lib/masters/registry.ts`, `src/lib/firm.ts`, `src/app/(app)/entries/actions.ts`, `src/app/(app)/entries/new/[slug]/page.tsx`, `src/app/(app)/entries/sheet/page.tsx`, `src/app/(app)/party/page.tsx`, `src/app/(app)/client/page.tsx`, `messages/en.json`, `messages/hi.json`
- Test: `tests/firm/firm.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/firm/firm.test.ts`, replace:

```ts
import { accountChoices, accountScope, allowedFirms, inScope, isCommonEntry, pickWorkingFirm, type AccountRow } from '@/lib/firm';
import { cashTransfer, siteCashExpense } from '@/lib/ledger/posting/cash';
import { vendorPayment } from '@/lib/ledger/posting/vendor';
import type { EntryDraft } from '@/lib/ledger/types';
```

with:

```ts
import {
  accountChoices, accountScope, allowedFirms, firmErrors, inScope, isCommonEntry, pickWorkingFirm, type AccountRow,
} from '@/lib/firm';
import { cashTransfer, siteCashExpense } from '@/lib/ledger/posting/cash';
import { vendorPayment } from '@/lib/ledger/posting/vendor';
import type { EntryDraft } from '@/lib/ledger/types';
import { getEntryForm } from '@/lib/masters/registry';
```

Then replace:

```ts
describe('isCommonEntry', () => {
```

with:

```ts
describe('firmErrors (checked on save)', () => {
  const fields = (slug: string) => getEntryForm(slug)!.fields;

  it('saves for the firm the form was opened in, even after a switch to the other firm', () => {
    // Opened in AB Infra, saved after switching to Jayraj: AB is still a firm this person may use.
    expect(firmErrors('vendor-bill', fields('vendor-bill'), AB, [AB, JI], {})).toBeNull();
  });

  it('refuses a firm the person may not use, or no firm on a firm’s form', () => {
    expect(firmErrors('vendor-bill', fields('vendor-bill'), JI, [AB], {})).toEqual({ _form: 'not_allowed' });
    expect(firmErrors('vendor-bill', fields('vendor-bill'), null, [AB], {})).toEqual({ _form: 'not_allowed' });
  });

  it('lets supervisors post without a firm, but not a firm’s form', () => {
    expect(firmErrors('site-spend', fields('site-spend'), null, null, {})).toBeNull();
    expect(firmErrors('vendor-bill', fields('vendor-bill'), null, null, {})).toEqual({ _form: 'not_allowed' });
    expect(firmErrors('site-spend', fields('site-spend'), AB, null, {})).toEqual({ _form: 'not_allowed' });
  });

  it('refuses the other firm’s work order', () => {
    expect(firmErrors('client-bill', fields('client-bill'), AB, [AB, JI], { work_order_id: JI })).toEqual({ work_order_id: 'other_firm' });
    expect(firmErrors('client-bill', fields('client-bill'), JI, [AB, JI], { work_order_id: JI })).toBeNull();
  });

  it('allows the other firm’s bank only where the form offers it', () => {
    const move = fields('move-money');
    expect(firmErrors('move-money', move, AB, [AB, JI], { from_account_id: JI, to_account_id: AB })).toEqual({ from_account_id: 'other_firm' });
    expect(firmErrors('move-money', move, AB, [AB, JI], { from_account_id: null, to_account_id: JI })).toBeNull();
    expect(firmErrors('pay-vendor', fields('pay-vendor'), AB, [AB, JI], { from_account_id: JI })).toBeNull();
    expect(firmErrors('site-spend', fields('site-spend'), AB, [AB, JI], { from_account_id: JI })).toEqual({ from_account_id: 'other_firm' });
  });
});

describe('isCommonEntry', () => {
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/firm`
Expected: FAIL. `firmErrors` is not exported yet.

- [ ] **Step 3: Take the firm field off the forms, and give the account fields their lists**

In `src/lib/masters/registry.ts`, replace:

```ts
const from: Field = { name: 'from_account_id', kind: 'ref', ref: 'moneyAccounts', required: true };
const to: Field = { name: 'to_account_id', kind: 'ref', ref: 'moneyAccounts', required: true };
```

with:

```ts
/** A bank or cash account field; `ref` says whether the other firm's banks are offered too (see RefSource). */
const account = (name: string, ref: RefSource = 'moneyAccounts'): Field => ({ name, kind: 'ref', ref, required: true });
const from = account('from_account_id');
```

Replace:

```ts
/**
 * The money forms, keyed by URL slug (/entries/new/<slug>), in the order the "Add an entry" page shows them.
 * `roles` mirrors what the database lets each role post (app_assert_can_post); the database has the final say.
 */
export const ENTRY_FORMS = {
  'vendor-bill': {
    icon: '🧾',
    roles: ['owner', 'office'],
    fields: [
      { name: 'firm_id', kind: 'ref', ref: 'firms', required: true },
      { name: 'vendor_id', kind: 'ref', ref: 'vendors', required: true },
```

with:

```ts
/**
 * The money forms, keyed by URL slug (/entries/new/<slug>), in the order the "Add an entry" page shows them.
 * `roles` mirrors what the database lets each role post (app_assert_can_post); the database has the final say.
 * None asks for the firm: forms are filled in the working firm, the one chosen at the top right.
 */
export const ENTRY_FORMS = {
  'vendor-bill': {
    icon: '🧾',
    roles: ['owner', 'office'],
    fields: [
      { name: 'vendor_id', kind: 'ref', ref: 'vendors', required: true },
```

Replace:

```ts
      { name: 'vendor_id', kind: 'ref', ref: 'vendors', required: true },
      { name: 'firm_id', kind: 'ref', ref: 'firms', required: true },
      from, amount, date, reference, note,
    ],
  },
```

with:

```ts
      { name: 'vendor_id', kind: 'ref', ref: 'vendors', required: true },
      // Another firm's bank may pay this firm's bill: this firm then owes that one.
      account('from_account_id', 'moneyAccountsWeOwe'), amount, date, reference, note,
    ],
  },
```

Replace:

```ts
    fields: [workOrder, to, amount, date, reference, note],
```

with:

```ts
    // The client's money may land in another firm's bank: that firm then owes this one.
    fields: [workOrder, account('to_account_id', 'moneyAccountsTheyOwe'), amount, date, reference, note],
```

Replace:

```ts
    fields: [from, to, amount, date, reference, note],
```

with:

```ts
    // Money leaves this firm's banks or common cash; it may go to another firm's bank, which then owes this firm.
    fields: [from, account('to_account_id', 'moneyAccountsTheyOwe'), amount, date, reference, note],
```

Replace:

```ts
export type EntryFormSlug = keyof typeof ENTRY_FORMS;
```

with:

```ts
export type EntryFormSlug = keyof typeof ENTRY_FORMS;

/**
 * Forms made for the working firm's own vendor or client. The others take their firm from the bank picked
 * (cash makes them common), as the posting rules always have.
 */
export const FIRM_FORMS: ReadonlySet<string> = new Set<EntryFormSlug>(['vendor-bill', 'pay-vendor', 'client-bill', 'client-receipt']);
```

- [ ] **Step 4: Add the save checks to the rules**

In `src/lib/firm.ts`, replace:

```ts
import type { Choice, RefSource } from '@/lib/masters/registry';
```

with:

```ts
import { FIRM_FORMS, type Choice, type Field, type RefSource } from '@/lib/masters/registry';
```

Then replace:

```ts
/** An entry that belongs to no firm: none of its lines names one (cash between the owner and supervisors, a supervisor's spend). */
```

with:

```ts
/**
 * What stops a form filled in `firmId` from being saved, as field errors (keys under `errors.*`); null when nothing does.
 * `allowed`: the firms this person may use, or null when they work without one (supervisors).
 * `picked`: for each work order or bank/cash field filled in, the firm of the row chosen (null = common cash).
 */
export function firmErrors(
  slug: string,
  fields: Field[],
  firmId: string | null,
  allowed: string[] | null,
  picked: Record<string, string | null>,
): Record<string, string> | null {
  if (allowed === null) return firmId === null && !FIRM_FORMS.has(slug) ? null : { _form: 'not_allowed' };
  if (!firmId || !allowed.includes(firmId)) return { _form: 'not_allowed' };
  for (const field of fields) {
    if (field.kind !== 'ref' || !(field.name in picked)) continue;
    const rowFirm = picked[field.name] ?? null;
    const scope = accountScope(field.ref);
    const fits = field.ref === 'workOrders' ? rowFirm === firmId : !scope || inScope(scope, rowFirm, firmId);
    if (!fits) return { [field.name]: 'other_firm' };
  }
  return null;
}

/** An entry that belongs to no firm: none of its lines names one (cash between the owner and supervisors, a supervisor's spend). */
```

- [ ] **Step 5: Run the rule tests**

Run: `npx vitest run tests/firm`
Expected: `Tests 14 passed (14)`.

- [ ] **Step 6: Save for the bound firm, after the checks**

In `src/app/(app)/entries/actions.ts`, replace:

```ts
import type { FormState } from '@/components/form';
import { requireProfile } from '@/lib/auth';
```

with:

```ts
import type { FormState } from '@/components/form';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { accountScope, firmErrors } from '@/lib/firm';
```

Replace:

```ts
import { getEntryForm, type EntryFormSlug } from '@/lib/masters/registry';
```

with:

```ts
import { getEntryForm, type EntryFormSlug, type Field } from '@/lib/masters/registry';
```

Replace:

```ts
/** Turns a submitted form into a balanced ledger entry, using the tested posting rules. */
async function buildDraft(slug: EntryFormSlug, v: Record<string, Value>, db: Db): Promise<EntryDraft> {
  const s = (name: string) => v[name] as string;
  const n = (name: string) => v[name] as number;

  switch (slug) {
    case 'vendor-bill': {
      const { materialId, costHead } = materialAndType(s);
      return vendorBill({
        firmId: s('firm_id'), vendorId: s('vendor_id'), siteId: s('site_id'), billDate: s('entry_date'), billNo: s('bill_no'),
        items: [{ costHead, amountPaise: n('amount') }], narration: s('narration'), materialId,
      });
    }
    case 'pay-vendor':
      return vendorPayment({
        billFirmId: s('firm_id'), vendorId: s('vendor_id'), from: await moneyAccount(db, s('from_account_id')),
```

with:

```ts
/**
 * For each work order or bank/cash field filled in, the firm of the row picked (null = common cash).
 * Rows the person may not see are left out; buildDraft then reports them as not found.
 */
async function firmsPicked(fields: Field[], v: Record<string, Value>, db: Db): Promise<Record<string, string | null>> {
  const picked: Record<string, string | null> = {};
  for (const field of fields) {
    const id = v[field.name];
    if (field.kind !== 'ref' || typeof id !== 'string') continue;
    const table = field.ref === 'workOrders' ? 'work_orders' : accountScope(field.ref) ? 'money_accounts' : null;
    if (!table) continue;
    const { data } = await db.from(table).select('firm_id').eq('id', id).maybeSingle();
    if (data) picked[field.name] = data.firm_id as string | null;
  }
  return picked;
}

/** Turns a submitted form into a balanced ledger entry, using the tested posting rules. `firmId` is the form's firm. */
async function buildDraft(slug: EntryFormSlug, v: Record<string, Value>, firmId: string | null, db: Db): Promise<EntryDraft> {
  const s = (name: string) => v[name] as string;
  const n = (name: string) => v[name] as number;

  switch (slug) {
    case 'vendor-bill': {
      const { materialId, costHead } = materialAndType(s);
      return vendorBill({
        firmId: firmId!, vendorId: s('vendor_id'), siteId: s('site_id'), billDate: s('entry_date'), billNo: s('bill_no'),
        items: [{ costHead, amountPaise: n('amount') }], narration: s('narration'), materialId,
      });
    }
    case 'pay-vendor':
      return vendorPayment({
        billFirmId: firmId!, vendorId: s('vendor_id'), from: await moneyAccount(db, s('from_account_id')),
```

Replace:

```ts
/**
 * Saves one entry as the signed-in user. The database checks permissions, balance and locks again.
 * `entryId` makes a retry safe: saving the same id twice returns the first entry instead of a copy.
 */
async function saveEntry(slug: string, data: FormData, db: Db, entryId?: string): Promise<Saved | FormState> {
  const form = getEntryForm(slug);
  const profile = await requireProfile();
  if (!form || !(form.roles as string[]).includes(profile.role)) return { errors: { _form: 'not_allowed' } };

  const values = submittedValues(data);
  const parsed = parseFields(form.fields, data);
  if (!parsed.ok) return { errors: parsed.errors, values };
```

with:

```ts
/**
 * Saves one entry as the signed-in user. The database checks permissions, balance and locks again.
 * `firmId` is the firm the form was opened in (null for supervisors): the entry is made for that firm,
 * even if the person has switched firm since. `entryId` makes a retry safe: saving the same id twice
 * returns the first entry instead of a copy.
 */
async function saveEntry(slug: string, firmId: string | null, data: FormData, db: Db, entryId?: string): Promise<Saved | FormState> {
  const form = getEntryForm(slug);
  const profile = await requireProfile();
  if (!form || !(form.roles as string[]).includes(profile.role)) return { errors: { _form: 'not_allowed' } };

  const values = submittedValues(data);
  const parsed = parseFields(form.fields, data);
  if (!parsed.ok) return { errors: parsed.errors, values };
  const working = await getWorkingFirm();
  const picked = working ? await firmsPicked(form.fields, parsed.values, db) : {};
  const wrong = firmErrors(slug, form.fields, firmId, working ? working.firms.map((f) => f.id) : null, picked);
  if (wrong) return { errors: wrong, values };
```

Replace:

```ts
    draft = await buildDraft(slug as EntryFormSlug, parsed.values, db);
```

with:

```ts
    draft = await buildDraft(slug as EntryFormSlug, parsed.values, firmId, db);
```

Replace:

```ts
/** Saves one money form, then opens the new entry. */
export async function postEntryForm(slug: string, _state: FormState, data: FormData): Promise<FormState> {
  const saved = await saveEntry(slug, data, await createClient());
  if (!('id' in saved)) return saved;
  revalidatePath('/', 'layout');
  redirect(`/entries/${saved.id}?saved=1`);
}

/** Saves sheet rows one by one, each through the same checks as the form. Result per row id. */
export async function postEntryRows(
  slug: string,
  rows: { id: string; cells: Record<string, string> }[],
): Promise<Record<string, Saved | FormState>> {
  const db = await createClient();
  const results: Record<string, Saved | FormState> = {};
  for (const row of rows) {
    const data = new FormData();
    for (const [name, value] of Object.entries(row.cells)) data.set(name, value);
    results[row.id] = await saveEntry(slug, data, db, row.id);
  }
  revalidatePath('/', 'layout');
  return results;
}

/** Sheet rows on a party's page: every row gets the same firm and vendor. */
export async function postPartyRows(
  slug: 'vendor-bill' | 'pay-vendor',
  fixed: { firm_id: string; vendor_id: string },
  rows: { id: string; cells: Record<string, string> }[],
): Promise<Record<string, Saved | FormState>> {
  return postEntryRows(slug, rows.map((row) => ({ ...row, cells: { ...row.cells, ...fixed } })));
}
```

with:

```ts
/** Saves one money form, then opens the new entry. `firmId`: the firm the form was opened in. */
export async function postEntryForm(slug: string, firmId: string | null, _state: FormState, data: FormData): Promise<FormState> {
  const saved = await saveEntry(slug, firmId, data, await createClient());
  if (!('id' in saved)) return saved;
  revalidatePath('/', 'layout');
  redirect(`/entries/${saved.id}?saved=1`);
}

/** Saves sheet rows one by one, each through the same checks as the form. Result per row id. */
export async function postEntryRows(
  slug: string,
  firmId: string | null,
  rows: { id: string; cells: Record<string, string> }[],
): Promise<Record<string, Saved | FormState>> {
  const db = await createClient();
  const results: Record<string, Saved | FormState> = {};
  for (const row of rows) {
    const data = new FormData();
    for (const [name, value] of Object.entries(row.cells)) data.set(name, value);
    results[row.id] = await saveEntry(slug, firmId, data, db, row.id);
  }
  revalidatePath('/', 'layout');
  return results;
}

/** Sheet rows on a party's page: every row is for the same firm and vendor. */
export async function postPartyRows(
  slug: 'vendor-bill' | 'pay-vendor',
  firmId: string,
  vendorId: string,
  rows: { id: string; cells: Record<string, string> }[],
): Promise<Record<string, Saved | FormState>> {
  return postEntryRows(slug, firmId, rows.map((row) => ({ ...row, cells: { ...row.cells, vendor_id: vendorId } })));
}
```

- [ ] **Step 7: The error words**

In `messages/en.json`, replace:

```json
    "reason_required": "Write what is wrong first."
```

with:

```json
    "reason_required": "Write what is wrong first.",
    "other_firm": "This belongs to the other firm. Switch firm at the top right first."
```

In `messages/hi.json`, replace:

```json
    "reason_required": "पहले लिखें कि क्या गलत है।"
```

with:

```json
    "reason_required": "पहले लिखें कि क्या गलत है।",
    "other_firm": "यह दूसरी फर्म का है। पहले ऊपर दाईं ओर से फर्म बदलें।"
```

- [ ] **Step 8: Say which firm a form is for**

Create `src/components/firm-line.tsx`:

```tsx
import type { getTranslations } from 'next-intl/server';
import type { Firm } from '@/lib/firm';
import { FIRM_FORMS } from '@/lib/masters/registry';

type T = Awaited<ReturnType<typeof getTranslations>>;

/** Above a form: the firm it is filled in, so nobody types into the wrong firm's books. */
export function FirmLine({ slug, firm, t }: { slug: string; firm: Firm; t: T }) {
  return <p className="firm-line">{t(FIRM_FORMS.has(slug) ? 'firm.for' : 'firm.workingIn', { firm: firm.name })}</p>;
}
```

- [ ] **Step 9: The entry form page**

In `src/app/(app)/entries/new/[slug]/page.tsx`, replace:

```tsx
import { Form } from '@/components/form';
import { requireProfile } from '@/lib/auth';
import { getEntryForm } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../../../masters/options';
import { postEntryForm } from '../../actions';
import { todayInIndia } from '../../data';

export default async function EntryFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = getEntryForm(slug);
  if (!form) notFound();
  const profile = await requireProfile();
  if (!(form.roles as string[]).includes(profile.role)) redirect('/entries/new');
  const db = await createClient();
  const [choices, t] = await Promise.all([loadChoices(db, form.fields), getTranslations()]);
```

with:

```tsx
import { FirmLine } from '@/components/firm-line';
import { Form } from '@/components/form';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { getEntryForm } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../../../masters/options';
import { postEntryForm } from '../../actions';
import { todayInIndia } from '../../data';

export default async function EntryFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = getEntryForm(slug);
  if (!form) notFound();
  const profile = await requireProfile();
  if (!(form.roles as string[]).includes(profile.role)) redirect('/entries/new');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working && profile.role !== 'supervisor') return <p className="empty">{t('party.noFirm')}</p>;
  const choices = await loadChoices(await createClient(), form.fields, working ? { working, t } : undefined);
```

Then replace:

```tsx
          <h1>{t(`entryForms.${slug}.title`)}</h1>
          <p className="lede">{t(`entryForms.${slug}.when`)}</p>
          <Form
            fields={form.fields}
            defaults={{ entry_date: todayInIndia() }}
            choices={choices}
            action={postEntryForm.bind(null, slug)}
```

with:

```tsx
          <h1>{t(`entryForms.${slug}.title`)}</h1>
          <p className="lede">{t(`entryForms.${slug}.when`)}</p>
          {working && <FirmLine slug={slug} firm={working.firm} t={t} />}
          <Form
            fields={form.fields}
            defaults={{ entry_date: todayInIndia() }}
            choices={choices}
            action={postEntryForm.bind(null, slug, working?.firm.id ?? null)}
```

- [ ] **Step 10: The sheet page**

In `src/app/(app)/entries/sheet/page.tsx`, replace:

```tsx
import { EntrySheet } from '@/components/entry-sheet';
import { requireProfile } from '@/lib/auth';
import { ENTRY_FORMS, getEntryForm } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../../masters/options';
import { postEntryRows } from '../actions';
import { todayInIndia } from '../data';
import { sheetColumns } from './columns';

/** Many entries of one kind at once, typed into rows like a spreadsheet. ?type=<entry form slug>. */
export default async function SheetPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const profile = await requireProfile();
  const slugs = Object.keys(ENTRY_FORMS).filter((s) => (getEntryForm(s)!.roles as string[]).includes(profile.role));
  const slug = type && slugs.includes(type) ? type : slugs[0]!;
  const form = getEntryForm(slug)!;
  const db = await createClient();
  const [choices, t] = await Promise.all([loadChoices(db, form.fields), getTranslations()]);

  const columns = sheetColumns(slug, form.fields, choices, t);
```

with:

```tsx
import { EntrySheet } from '@/components/entry-sheet';
import { FirmLine } from '@/components/firm-line';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { ENTRY_FORMS, getEntryForm } from '@/lib/masters/registry';
import { createClient } from '@/lib/supabase/server';
import { loadChoices } from '../../masters/options';
import { postEntryRows } from '../actions';
import { todayInIndia } from '../data';
import { sheetColumns } from './columns';

/** Many entries of one kind at once, typed into rows like a spreadsheet, in the working firm. ?type=<entry form slug>. */
export default async function SheetPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const profile = await requireProfile();
  const slugs = Object.keys(ENTRY_FORMS).filter((s) => (getEntryForm(s)!.roles as string[]).includes(profile.role));
  const slug = type && slugs.includes(type) ? type : slugs[0]!;
  const form = getEntryForm(slug)!;
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working && profile.role !== 'supervisor') return <p className="empty">{t('party.noFirm')}</p>;
  const choices = await loadChoices(await createClient(), form.fields, working ? { working, t } : undefined);

  const columns = sheetColumns(slug, form.fields, choices, t);
```

Then replace:

```tsx
      <p className="hint">{t(`entryForms.${slug}.what`)}</p>
      {/* A new key per type starts a fresh sheet with that type's columns. */}
      <EntrySheet key={slug} columns={columns} today={todayInIndia()} save={postEntryRows.bind(null, slug)} />
```

with:

```tsx
      <p className="hint">{t(`entryForms.${slug}.what`)}</p>
      {working && <FirmLine slug={slug} firm={working.firm} t={t} />}
      {/* A new key per type and firm starts a fresh sheet with that type's columns and that firm's lists. */}
      <EntrySheet
        key={`${slug}-${working?.firm.id}`}
        columns={columns}
        today={todayInIndia()}
        save={postEntryRows.bind(null, slug, working?.firm.id ?? null)}
      />
```

- [ ] **Step 11: Keep the party and client pages saving**

These pages still take their firm from the address until Task 6. Here they only follow the new save signatures and list names.

In `src/app/(app)/party/page.tsx`, delete the line:

```ts
  const fixed = { firm_id: firm.id, vendor_id: party.id };
```

Replace:

```ts
  const missing = (source: 'sites' | 'moneyAccounts', slug: string, key: string) =>
```

with:

```ts
  const missing = (source: 'sites' | 'moneyAccountsWeOwe', slug: string, key: string) =>
```

Replace:

```tsx
          {missing('moneyAccounts', 'money-accounts', 'needAccount')}
```

with:

```tsx
          {missing('moneyAccountsWeOwe', 'money-accounts', 'needAccount')}
```

Replace:

```tsx
            save={postPartyRows.bind(null, 'vendor-bill', fixed)}
```

with:

```tsx
            save={postPartyRows.bind(null, 'vendor-bill', firm.id, party.id)}
```

Replace:

```tsx
            save={postPartyRows.bind(null, 'pay-vendor', fixed)}
```

with:

```tsx
            save={postPartyRows.bind(null, 'pay-vendor', firm.id, party.id)}
```

In `src/app/(app)/client/page.tsx`, replace:

```tsx
            save={postEntryRows.bind(null, 'client-bill')}
```

with:

```tsx
            save={postEntryRows.bind(null, 'client-bill', firm.id)}
```

Replace:

```tsx
          {(choices.moneyAccounts ?? []).length === 0 && (
```

with:

```tsx
          {(choices.moneyAccountsTheyOwe ?? []).length === 0 && (
```

Replace:

```tsx
            save={postEntryRows.bind(null, 'client-receipt')}
```

with:

```tsx
            save={postEntryRows.bind(null, 'client-receipt', firm.id)}
```

- [ ] **Step 12: Check**

Run: `npm run typecheck`
Expected: no output.

Run: `npm test`
Expected: `Test Files 23 passed (23)`, `Tests 129 passed (129)`.

- [ ] **Step 13: Commit**

```bash
git add src/lib/masters/registry.ts src/lib/firm.ts tests/firm/firm.test.ts "src/app/(app)/entries/actions.ts" src/components/firm-line.tsx "src/app/(app)/entries/new/[slug]/page.tsx" "src/app/(app)/entries/sheet/page.tsx" "src/app/(app)/party/page.tsx" "src/app/(app)/client/page.tsx" messages/en.json messages/hi.json
git commit -m "feat: make entries for the firm their form was opened in, and check it on save"
```

---

### Task 6: The firm pages follow the working firm

**Files:**
- Modify: `src/app/(app)/party/shared.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/clients/page.tsx`, `src/app/(app)/party/page.tsx`, `src/app/(app)/client/page.tsx`, `messages/en.json`, `messages/hi.json`

- [ ] **Step 1: Shared loaders take the firm; the firm chips go**

In `src/app/(app)/party/shared.tsx`, replace:

```tsx
import Link from 'next/link';
import type { getTranslations } from 'next-intl/server';
import { clientFigures, partyFigures, type ClientTotalRow, type PartyFigures, type PartyStatus, type PartyTotalRow } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;
type T = Awaited<ReturnType<typeof getTranslations>>;
export type Firm = { id: string; name: string };
export type PartyLine = { id: string; name: string; f: PartyFigures };
export type ClientLine = { id: string; name: string; f: ReturnType<typeof clientFigures> };

/** The firms the user may see and the chosen one; with none chosen, the first that has rows in `view`. */
async function pickFirm(db: Db, firmId: string | undefined, view: 'party_totals' | 'client_totals') {
  const { data } = await db.from('firms').select('id, name').order('name').returns<Firm[]>();
  const firms = data ?? [];
  let firm = firms.find((f) => f.id === firmId);
  if (!firm) {
    const { data: used } = await db.from(view).select('firm_id').limit(1);
    firm = firms.find((f) => f.id === used?.[0]?.firm_id) ?? firms[0];
  }
  return { firms, firm };
}

async function partyNames(db: Db) {
```

with:

```tsx
import type { getTranslations } from 'next-intl/server';
import { clientFigures, partyFigures, type ClientTotalRow, type PartyFigures, type PartyStatus, type PartyTotalRow } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import type { createClient } from '@/lib/supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;
type T = Awaited<ReturnType<typeof getTranslations>>;
export type PartyLine = { id: string; name: string; f: PartyFigures };
export type ClientLine = { id: string; name: string; f: ReturnType<typeof clientFigures> };

async function partyNames(db: Db) {
```

Then replace:

```tsx
/** The vendors a firm owes, A to Z, with their figures. */
export async function loadFirmParties(db: Db, firmId?: string): Promise<{ firms: Firm[]; firm?: Firm; parties: PartyLine[] }> {
  const { firms, firm } = await pickFirm(db, firmId, 'party_totals');
  if (!firm) return { firms, parties: [] };
  const [{ data: totals }, nameOf] = await Promise.all([
    db.from('party_totals').select('*').eq('firm_id', firm.id).returns<PartyTotalRow[]>(),
    partyNames(db),
  ]);
  const parties = (totals ?? []).map((row) => ({ id: row.party_id, name: nameOf.get(row.party_id) ?? '', f: partyFigures(row) }));
  return { firms, firm, parties: parties.sort(byName) };
}

/** The clients who owe a firm, A to Z, with their figures. */
export async function loadFirmClients(db: Db, firmId?: string): Promise<{ firms: Firm[]; firm?: Firm; clients: ClientLine[] }> {
  const { firms, firm } = await pickFirm(db, firmId, 'client_totals');
  if (!firm) return { firms, clients: [] };
  const [{ data: totals }, nameOf] = await Promise.all([
    db.from('client_totals').select('*').eq('firm_id', firm.id).returns<ClientTotalRow[]>(),
    partyNames(db),
  ]);
  const clients = (totals ?? []).map((row) => ({ id: row.party_id, name: nameOf.get(row.party_id) ?? '', f: clientFigures(row) }));
  return { firms, firm, clients: clients.sort(byName) };
}

/** One chip per firm, like the workbook's one file per firm. */
export function FirmTabs({ firms, firm, path, t }: { firms: Firm[]; firm: Firm; path: string; t: T }) {
  if (firms.length < 2) return null;
  return (
    <nav className="filters" aria-label={t('party.firms')}>
      {firms.map((f) => (
        <Link key={f.id} href={`${path}?firm=${f.id}`} className={`chip${f.id === firm.id ? ' on' : ''}`} aria-current={f.id === firm.id ? 'page' : undefined}>
          {f.name}
        </Link>
      ))}
    </nav>
  );
}
```

with:

```tsx
/** The vendors a firm owes, A to Z, with their figures. */
export async function loadFirmParties(db: Db, firmId: string): Promise<PartyLine[]> {
  const [{ data: totals }, nameOf] = await Promise.all([
    db.from('party_totals').select('*').eq('firm_id', firmId).returns<PartyTotalRow[]>(),
    partyNames(db),
  ]);
  const parties = (totals ?? []).map((row) => ({ id: row.party_id, name: nameOf.get(row.party_id) ?? '', f: partyFigures(row) }));
  return parties.sort(byName);
}

/** The clients who owe a firm, A to Z, with their figures. */
export async function loadFirmClients(db: Db, firmId: string): Promise<ClientLine[]> {
  const [{ data: totals }, nameOf] = await Promise.all([
    db.from('client_totals').select('*').eq('firm_id', firmId).returns<ClientTotalRow[]>(),
    partyNames(db),
  ]);
  const clients = (totals ?? []).map((row) => ({ id: row.party_id, name: nameOf.get(row.party_id) ?? '', f: clientFigures(row) }));
  return clients.sort(byName);
}
```

- [ ] **Step 2: Parties (home)**

In `src/app/(app)/page.tsx`, replace:

```tsx
import { RowFilter } from '@/components/row-filter';
import { requireProfile } from '@/lib/auth';
import { sumFigures } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate } from './entries/data';
import { FirmTabs, loadFirmParties, MoneyCell, Stat, StatusPill } from './party/shared';

/** Home: every party a firm owes, one line each, like the Index sheet of the outstanding workbook. */
export default async function PartyIndexPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const profile = await requireProfile();
  if (profile.role === 'supervisor') redirect('/overview');
  const { firm: want } = await searchParams;
  const db = await createClient();
  const [{ firms, firm, parties }, { data: vendors }, t] = await Promise.all([
    loadFirmParties(db, want),
    db.from('parties').select('id, name').eq('kind', 'vendor').eq('is_active', true).order('name'),
    getTranslations(),
  ]);
  if (!firm) return <p className="empty">{t('party.noFirm')}</p>;
  const sum = sumFigures(parties.map((p) => p.f));
```

with:

```tsx
import { RowFilter } from '@/components/row-filter';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { sumFigures } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate } from './entries/data';
import { loadFirmParties, MoneyCell, Stat, StatusPill } from './party/shared';

/** Home: every party the working firm owes, one line each, like the Index sheet of the outstanding workbook. */
export default async function PartyIndexPage() {
  const profile = await requireProfile();
  if (profile.role === 'supervisor') redirect('/overview');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const [parties, { data: vendors }] = await Promise.all([
    loadFirmParties(db, firm.id),
    db.from('parties').select('id, name').eq('kind', 'vendor').eq('is_active', true).order('name'),
  ]);
  const sum = sumFigures(parties.map((p) => p.f));
```

Replace:

```tsx
        <Link href={`/dashboard?firm=${firm.id}`} className="btn ghost">{t('nav.dashboard')} ►</Link>
      </div>
      <FirmTabs firms={firms} firm={firm} path="/" t={t} />
```

with:

```tsx
        <Link href="/dashboard" className="btn ghost">{t('nav.dashboard')} ►</Link>
      </div>
```

Replace:

```tsx
                    <td><Link href={`/party?firm=${firm.id}&id=${id}`} className="party-link">{name}</Link></td>
```

with:

```tsx
                    <td><Link href={`/party?id=${id}`} className="party-link">{name}</Link></td>
```

Replace:

```tsx
      <form action="/party" className="open-other card">
        <input type="hidden" name="firm" value={firm.id} />
```

with:

```tsx
      <form action="/party" className="open-other card">
```

- [ ] **Step 3: Dashboard**

In `src/app/(app)/dashboard/page.tsx`, replace:

```tsx
import { requireProfile } from '@/lib/auth';
import { sumFigures } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { FirmTabs, loadFirmParties, MoneyCell, Stat } from '../party/shared';

/** The workbook's Dashboard sheet: big totals, counts by status, the top 5 and a bar per party. */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  await requireProfile('owner', 'office');
  const { firm: want } = await searchParams;
  const [{ firms, firm, parties }, t] = await Promise.all([loadFirmParties(await createClient(), want), getTranslations()]);
  if (!firm) return <p className="empty">{t('party.noFirm')}</p>;
  const sum = sumFigures(parties.map((p) => p.f));
```

with:

```tsx
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { sumFigures } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadFirmParties, MoneyCell, Stat } from '../party/shared';

/** The workbook's Dashboard sheet for the working firm: big totals, counts by status, the top 5 and a bar per party. */
export default async function DashboardPage() {
  await requireProfile('owner', 'office');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const parties = await loadFirmParties(await createClient(), firm.id);
  const sum = sumFigures(parties.map((p) => p.f));
```

Replace:

```tsx
        <Link href={`/?firm=${firm.id}`} className="btn ghost">◄ {t('party.home')}</Link>
      </div>
      <FirmTabs firms={firms} firm={firm} path="/dashboard" t={t} />
```

with:

```tsx
        <Link href="/" className="btn ghost">◄ {t('party.home')}</Link>
      </div>
```

Replace:

```tsx
                  <td><Link href={`/party?firm=${firm.id}&id=${id}`} className="party-link">{name}</Link></td>
```

with:

```tsx
                  <td><Link href={`/party?id=${id}`} className="party-link">{name}</Link></td>
```

- [ ] **Step 4: Clients**

In `src/app/(app)/clients/page.tsx`, replace:

```tsx
import { RowFilter } from '@/components/row-filter';
import { requireProfile } from '@/lib/auth';
import { sumFigures } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate } from '../entries/data';
import { FirmTabs, loadFirmClients, MoneyCell, Stat, StatusPill } from '../party/shared';

/** Every client who owes a firm, one line each: the client side of the party list. */
export default async function ClientIndexPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  await requireProfile('owner', 'office');
  const { firm: want } = await searchParams;
  const db = await createClient();
  const [{ firms, firm, clients }, { data: all }, t] = await Promise.all([
    loadFirmClients(db, want),
    db.from('parties').select('id, name').eq('kind', 'client').eq('is_active', true).order('name'),
    getTranslations(),
  ]);
  if (!firm) return <p className="empty">{t('party.noFirm')}</p>;
  const sum = sumFigures(clients.map((c) => c.f));
```

with:

```tsx
import { RowFilter } from '@/components/row-filter';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { sumFigures } from '@/lib/ledger/party';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { showDate } from '../entries/data';
import { loadFirmClients, MoneyCell, Stat, StatusPill } from '../party/shared';

/** Every client who owes the working firm, one line each: the client side of the party list. */
export default async function ClientIndexPage() {
  await requireProfile('owner', 'office');
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const [clients, { data: all }] = await Promise.all([
    loadFirmClients(db, firm.id),
    db.from('parties').select('id, name').eq('kind', 'client').eq('is_active', true).order('name'),
  ]);
  const sum = sumFigures(clients.map((c) => c.f));
```

Replace:

```tsx
      </div>
      <FirmTabs firms={firms} firm={firm} path="/clients" t={t} />
```

with:

```tsx
      </div>
```

Replace:

```tsx
                    <td><Link href={`/client?firm=${firm.id}&id=${id}`} className="party-link">{name}</Link></td>
```

with:

```tsx
                    <td><Link href={`/client?id=${id}`} className="party-link">{name}</Link></td>
```

Replace:

```tsx
      <form action="/client" className="open-other card">
        <input type="hidden" name="firm" value={firm.id} />
```

with:

```tsx
      <form action="/client" className="open-other card">
```

- [ ] **Step 5: One party's page**

In `src/app/(app)/party/page.tsx`, replace:

```tsx
import { requireProfile } from '@/lib/auth';
```

with:

```tsx
import { getWorkingFirm, requireProfile } from '@/lib/auth';
```

Replace:

```tsx
/** One party's page for one firm, like a vendor sheet of the outstanding workbook. ?firm=&id= */
export default async function PartyPage({ searchParams }: { searchParams: Promise<{ firm?: string; id?: string }> }) {
  await requireProfile('owner', 'office');
  const { firm: firmId = '', id = '' } = await searchParams;
  const db = await createClient();
  const [{ data: firm }, { data: party }] = await Promise.all([
    db.from('firms').select('id, name').eq('id', firmId).maybeSingle(),
    db.from('parties').select('id, name').eq('id', id).maybeSingle(),
  ]);
  if (!firm || !party) notFound();

  const billFields = fieldsOf('vendor-bill', BILL_COLUMNS);
  const payFields = fieldsOf('pay-vendor', PAY_COLUMNS);
  const [{ data }, names, choices, t, { data: materials }] = await Promise.all([
    db.from('party_rows').select('*').eq('firm_id', firm.id).eq('party_id', party.id)
      .order('entry_date').order('serial').returns<PartyRow[]>(),
    loadNames(db),
    loadChoices(db, [...billFields, ...payFields]),
    getTranslations(),
    db.from('materials').select('id, name'),
  ]);
```

with:

```tsx
/** One party's page in the working firm, like a vendor sheet of the outstanding workbook. ?id= */
export default async function PartyPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireProfile('owner', 'office');
  const { id = '' } = await searchParams;
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const { data: party } = await db.from('parties').select('id, name').eq('id', id).maybeSingle();
  if (!party) notFound();

  const billFields = fieldsOf('vendor-bill', BILL_COLUMNS);
  const payFields = fieldsOf('pay-vendor', PAY_COLUMNS);
  const [{ data }, names, choices, { data: materials }] = await Promise.all([
    db.from('party_rows').select('*').eq('firm_id', firm.id).eq('party_id', party.id)
      .order('entry_date').order('serial').returns<PartyRow[]>(),
    loadNames(db),
    loadChoices(db, [...billFields, ...payFields], { working, t }),
    db.from('materials').select('id, name'),
  ]);
```

Replace:

```tsx
      <Link href={`/?firm=${firm.id}`} className="back">◄ {t('party.home')}</Link>
```

with:

```tsx
      <Link href="/" className="back">◄ {t('party.home')}</Link>
```

- [ ] **Step 6: One client's page**

In `src/app/(app)/client/page.tsx`, replace:

```tsx
import { requireProfile } from '@/lib/auth';
```

with:

```tsx
import { getWorkingFirm, requireProfile } from '@/lib/auth';
```

Replace:

```tsx
/** One client's page for one firm: bills given and money received. ?firm=&id= */
export default async function ClientPage({ searchParams }: { searchParams: Promise<{ firm?: string; id?: string }> }) {
  await requireProfile('owner', 'office');
  const { firm: firmId = '', id = '' } = await searchParams;
  const db = await createClient();
  const [{ data: firm }, { data: client }] = await Promise.all([
    db.from('firms').select('id, name').eq('id', firmId).maybeSingle(),
    db.from('parties').select('id, name').eq('id', id).eq('kind', 'client').maybeSingle(),
  ]);
  if (!firm || !client) notFound();

  const billFields = fieldsOf('client-bill', BILL_COLUMNS);
  const receiptFields = fieldsOf('client-receipt', RECEIPT_COLUMNS);
  const [{ data }, { data: orders }, names, choices, t] = await Promise.all([
    db.from('client_rows').select('*').eq('firm_id', firm.id).eq('party_id', client.id)
      .order('entry_date').order('serial').returns<ClientRow[]>(),
    db.from('work_orders').select('id, ref, is_active, site:sites(name)').eq('firm_id', firm.id).eq('client_id', client.id)
      .order('ref').returns<{ id: string; ref: string; is_active: boolean; site: { name: string } | null }[]>(),
    loadNames(db),
    loadChoices(db, [...billFields, ...receiptFields]),
    getTranslations(),
  ]);
```

with:

```tsx
/** One client's page in the working firm: bills given and money received. ?id= */
export default async function ClientPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireProfile('owner', 'office');
  const { id = '' } = await searchParams;
  const [working, t] = await Promise.all([getWorkingFirm(), getTranslations()]);
  if (!working) return <p className="empty">{t('party.noFirm')}</p>;
  const { firm } = working;
  const db = await createClient();
  const { data: client } = await db.from('parties').select('id, name').eq('id', id).eq('kind', 'client').maybeSingle();
  if (!client) notFound();

  const billFields = fieldsOf('client-bill', BILL_COLUMNS);
  const receiptFields = fieldsOf('client-receipt', RECEIPT_COLUMNS);
  const [{ data }, { data: orders }, names, choices] = await Promise.all([
    db.from('client_rows').select('*').eq('firm_id', firm.id).eq('party_id', client.id)
      .order('entry_date').order('serial').returns<ClientRow[]>(),
    db.from('work_orders').select('id, ref, is_active, site:sites(name)').eq('firm_id', firm.id).eq('client_id', client.id)
      .order('ref').returns<{ id: string; ref: string; is_active: boolean; site: { name: string } | null }[]>(),
    loadNames(db),
    loadChoices(db, [...billFields, ...receiptFields], { working, t }),
  ]);
```

Replace:

```tsx
      <Link href={`/clients?firm=${firm.id}`} className="back">◄ {t('client.home')}</Link>
```

with:

```tsx
      <Link href="/clients" className="back">◄ {t('client.home')}</Link>
```

- [ ] **Step 7: Remove the firm-chips label**

In `messages/en.json`, replace:

```json
  "party": {
    "firms": "Firms",
    "indexTitle"
```

with:

```json
  "party": {
    "indexTitle"
```

In `messages/hi.json`, replace:

```json
  "party": {
    "firms": "फर्म",
    "indexTitle"
```

with:

```json
  "party": {
    "indexTitle"
```

- [ ] **Step 8: Check**

Run: `npm run typecheck`
Expected: no output.

Run: `npm test`
Expected: `Tests 129 passed (129)`.

Run: `git grep -n "firm=" -- src`
Expected: matches only in `src/app/(app)/entries/page.tsx`, `src/app/(app)/overview/page.tsx` and `src/components/board.tsx`. Tasks 7 and 8 remove those.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/party/shared.tsx" "src/app/(app)/page.tsx" "src/app/(app)/dashboard/page.tsx" "src/app/(app)/clients/page.tsx" "src/app/(app)/party/page.tsx" "src/app/(app)/client/page.tsx" messages/en.json messages/hi.json
git commit -m "feat: parties, clients and dashboard show the working firm"
```

---

### Task 7: The day book in the working firm, with Common entries

**Files:**
- Modify: `src/app/(app)/entries/page.tsx` (whole file), `src/components/board.tsx`, `messages/en.json`, `messages/hi.json`

- [ ] **Step 1: Replace the day book page**

Replace the whole of `src/app/(app)/entries/page.tsx` with:

```tsx
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AutoForm } from '@/components/auto-form';
import { GroupCards, GROUPS, SitesTable } from '@/components/board';
import { getWorkingFirm, requireProfile } from '@/lib/auth';
import { isCommonEntry } from '@/lib/firm';
import { describeAll, type LineRow } from '@/lib/ledger/plain';
import { showPaise } from '@/lib/money';
import { createClient } from '@/lib/supabase/server';
import { loadNames, showDate } from './data';

interface Row {
  id: string;
  serial: string;
  entry_type: string;
  entry_date: string;
  party_id: string | null;
  narration: string;
  created_at: string;
  lines: { account: string; amount_paise: number; firm_id: string | null }[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ponytail: latest 200 only; add paging when the books outgrow it.
const LIMIT = 200;

type Params = { waiting?: string; date?: string; site?: string };

/**
 * Every entry, newest first. Owner and office staff see the working firm's entries plus the Common ones (no firm on
 * any line, e.g. cash handed to a supervisor), which carry a tag. Supervisors see the entries they may see.
 * Filters: ?waiting=1 (not yet checked), ?date=YYYY-MM-DD, ?site=<id>. A firm or site adds a summary of its books.
 */
export default async function DayBookPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { waiting } = params;
  const date = params.date && DATE.test(params.date) ? params.date : undefined;
  const site = params.site && UUID.test(params.site) ? params.site : undefined;
  const profile = await requireProfile();
  const working = await getWorkingFirm();
  const firm = working?.firm.id;
  const db = await createClient();

  const { data: statuses } = await db.from('entry_status').select('entry_id, status');
  const statusOf = new Map((statuses ?? []).map((s) => [s.entry_id as string, s.status as string]));
  const waitingIds = [...statusOf].filter(([, s]) => s === 'unverified').map(([id]) => id);

  // `lines` sizes the entry and shows whether it names a firm; `match` (an inner join on the same lines) keeps only
  // entries touching the firm/site. Common entries all have the CM serial (no entry firm); `lines` tells which of those
  // name no firm at all, since a firm's bill paid from owner cash is CM too.
  const list = (only?: 'firm' | 'common') => {
    let query = db
      .from('entries')
      .select(`id, serial, entry_type, entry_date, party_id, narration, created_at, lines:entry_lines(account, amount_paise, firm_id)${only === 'firm' || site ? ', match:entry_lines!inner(firm_id, site_id)' : ''}`)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (date) query = query.eq('entry_date', date);
    if (waiting) query = query.in('id', waitingIds);
    if (only === 'firm') query = query.eq('match.firm_id', firm!);
    if (only === 'common') query = query.is('firm_id', null);
    if (site) query = query.eq('match.site_id', site);
    return query.returns<Row[]>();
  };

  // What the books show now for this firm and/or site. A firm also sees the between-firm amounts other firms hold against it.
  let balances = db.from('balances').select('*');
  if (site) balances = balances.eq('site_id', site);
  if (firm) balances = site ? balances.eq('firm_id', firm) : balances.or(`firm_id.eq.${firm},counter_firm_id.eq.${firm}`);

  const [{ data: own }, { data: cm }, { data: summary }, names, t] = await Promise.all([
    firm ? list('firm') : list(),
    firm ? list('common') : Promise.resolve({ data: [] as Row[] }),
    // Supervisors see their entries but not profits, as on the home page.
    (firm || site) && profile.role !== 'supervisor' ? balances.returns<LineRow[]>() : Promise.resolve({ data: null }),
    loadNames(db),
    getTranslations(),
  ]);
  const common = (cm ?? []).filter((r) => isCommonEntry(r.lines));
  const commonIds = new Set(common.map((r) => r.id));
  const rows = [...(own ?? []), ...common].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, LIMIT);

  // The size of an entry: its plus lines, leaving out the automatic between-firm pair.
  const amountOf = (r: Row) =>
    r.lines.filter((l) => l.account !== 'inter_firm' && l.amount_paise > 0).reduce((s, l) => s + Number(l.amount_paise), 0);
  const href = (change: Partial<Params>) => {
    const next = new URLSearchParams(Object.entries({ site, date, waiting, ...change }).filter(([, v]) => v) as [string, string][]);
    return `/entries${next.size ? `?${next}` : ''}`;
  };
  const firmName = working?.firm.name;
  const siteName = site && names.sites.get(site);
  const title = firmName && siteName ? t('daybook.at', { firm: firmName, site: siteName }) : (firmName || siteName || t('nav.daybook'));

  // Costs at the site by kind of work (material, labour, ...), biggest first.
  const costs = new Map<string, number>();
  for (const r of summary ?? []) if (site && r.account === 'site_cost') costs.set(r.cost_head!, (costs.get(r.cost_head!) ?? 0) + Number(r.amount_paise));

  return (
    <>
      <p className="eyebrow">{t('daybook.eyebrow')}</p>
      <h1>{title}</h1>
      <p className="lede">{t(site ? 'daybook.siteLede' : firm ? 'daybook.firmLede' : 'daybook.lede')}</p>

      <AutoForm action="/entries" className="filters book-filter">
        <label className="sr-only" htmlFor="site">{t('daybook.site')}</label>
        <select id="site" name="site" defaultValue={site ?? ''}>
          <option value="">{t('daybook.allSites')}</option>
          {[...names.sites].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label htmlFor="date" className="sr-only">{t('daybook.onDate')}</label>
        <input id="date" type="date" name="date" defaultValue={date ?? ''} />
        {waiting && <input type="hidden" name="waiting" value="1" />}
        {(site || date || waiting) && <Link href="/entries" className="chip">{t('daybook.clear')}</Link>}
      </AutoForm>

      {summary && (
        <div className="book-summary">
          <SitesTable rows={summary} names={names} t={t} hint={t(firm ? 'daybook.sitesHintFirm' : 'board.sites.hint')} />
          {costs.size > 0 && (
            <section className="card">
              <h2 className="eyebrow">{t('daybook.costs')}</h2>
              <p className="hint">{t('daybook.costsHint')}</p>
              {[...costs].sort((a, b) => b[1] - a[1]).map(([head, amount]) => (
                <div key={head} className="row">
                  <span className="name">{t(`options.cost_head.${head}`)}</span>
                  <span className="val">{showPaise(amount)}</span>
                </div>
              ))}
            </section>
          )}
          {firm && !site && (
            <GroupCards plain={describeAll(summary, names, t)} groups={GROUPS.filter((g) => g !== 'owner')} t={t} />
          )}
        </div>
      )}

      <div className="filters">
        <Link href={href({ waiting: undefined })} className={`chip ${!waiting ? 'on' : ''}`}>{t('daybook.all')}</Link>
        <Link href={href({ waiting: '1' })} className={`chip ${waiting ? 'on' : ''}`}>
          {t('daybook.waiting')}{' '}
          <b>{firm || site || date ? rows.filter((r) => statusOf.get(r.id) === 'unverified').length : waitingIds.length}</b>
        </Link>
        <span className="muted">{t('daybook.count', { count: rows.length })}</span>
      </div>
      {rows.length > 0 ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('daybook.serial')}</th>
                <th>{t('daybook.date')}</th>
                <th>{t('daybook.what')}</th>
                <th className="num">{t('daybook.amount')}</th>
                <th>{t('daybook.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = statusOf.get(r.id) ?? 'unverified';
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/entries/${r.id}`} className="serial underline">{r.serial}</Link>
                    </td>
                    <td className="nowrap">{showDate(r.entry_date)}</td>
                    <td>
                      <b>{t(`entryTypes.${r.entry_type}.title`)}</b>
                      {commonIds.has(r.id) && <span className="pill common" title={t('firm.commonHint')}>{t('firm.common')}</span>}
                      {(r.party_id || r.narration) && (
                        <span className="muted block">
                          {[r.party_id && names.parties.get(r.party_id), r.narration].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className="num">{showPaise(amountOf(r))}</td>
                    <td><span className={`pill ${status}`}>{t(`entries.status.${status}`)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">{t('daybook.empty')}</p>
      )}
    </>
  );
}
```

- [ ] **Step 2: Site links no longer carry a firm**

In `src/components/board.tsx`, replace:

```tsx
/** Billed, costs and profit per site; each site name opens that site's entries (for `firmId` only, if given). */
export function SitesTable({ rows, names, t, hint, firmId }: { rows: LineRow[]; names: Names; t: T; hint: string; firmId?: string }) {
```

with:

```tsx
/** Billed, costs and profit per site; each site name opens that site's entries in the working firm. */
export function SitesTable({ rows, names, t, hint }: { rows: LineRow[]; names: Names; t: T; hint: string }) {
```

Replace:

```tsx
                    <Link href={`/entries?site=${id}${firmId ? `&firm=${firmId}` : ''}`} className="underline">{names.sites.get(id)}</Link>
```

with:

```tsx
                    <Link href={`/entries?site=${id}`} className="underline">{names.sites.get(id)}</Link>
```

- [ ] **Step 3: Remove the firm dropdown's words**

In `messages/en.json`, replace:

```json
    "firm": "Firm",
    "site": "Site",
    "allFirms": "All firms",
    "allSites": "All sites",
```

with:

```json
    "site": "Site",
    "allSites": "All sites",
```

In `messages/hi.json`, replace:

```json
    "firm": "फर्म",
    "site": "साइट",
    "allFirms": "सभी फर्म",
    "allSites": "सभी साइट",
```

with:

```json
    "site": "साइट",
    "allSites": "सभी साइट",
```

- [ ] **Step 4: Check**

Run: `npm run typecheck`
Expected: no output.

Run: `npm test`
Expected: `Tests 129 passed (129)`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/entries/page.tsx" src/components/board.tsx messages/en.json messages/hi.json
git commit -m "feat: day book shows the working firm's entries and tags common ones"
```

---

### Task 8: Overview loses its per-firm links

**Files:**
- Modify: `src/app/(app)/overview/page.tsx`, `src/app/globals.css`, `messages/en.json`, `messages/hi.json`

- [ ] **Step 1: Remove the links**

In `src/app/(app)/overview/page.tsx`, replace:

```tsx
          {!supervisor && (
            <>
              <nav className="filters firm-links" aria-label={t('board.firms')}>
                <span className="muted">{t('board.firms')}</span>
                {[...names.firms].map(([id, name]) => (
                  <Link key={id} href={`/entries?firm=${id}`} className="chip">{name} →</Link>
                ))}
              </nav>
              <SitesTable rows={balances} names={names} t={t} hint={t('board.sites.hint')} />
            </>
          )}
```

with:

```tsx
          {!supervisor && <SitesTable rows={balances} names={names} t={t} hint={t('board.sites.hint')} />}
```

- [ ] **Step 2: Remove their style and words**

In `src/app/globals.css`, delete the line:

```css
.firm-links { margin-top: 16px; }
```

In `messages/en.json`, replace:

```json
      "profit": "Profit"
    },
    "firms": "See one firm’s books:"
  },
```

with:

```json
      "profit": "Profit"
    }
  },
```

In `messages/hi.json`, replace:

```json
      "profit": "मुनाफ़ा"
    },
    "firms": "एक फर्म के खाते देखें:"
  },
```

with:

```json
      "profit": "मुनाफ़ा"
    }
  },
```

- [ ] **Step 3: Check**

Run: `npm run typecheck`
Expected: no output.

Run: `npm test`
Expected: `Tests 129 passed (129)`.

Run: `git grep -n "firm=" -- src`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/overview/page.tsx" src/app/globals.css messages/en.json messages/hi.json
git commit -m "chore: drop the overview's per-firm links, now that the switcher sets the firm"
```

---

### Task 9: Verify, update the live database, and try it by hand

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: The full checks**

Run: `npm test`
Expected: `Test Files 23 passed (23)`, `Tests 129 passed (129)`.

Run: `npm run typecheck`
Expected: no output.

Run: `npm run build`
Expected: `✓ Compiled successfully`, and a route list from `/` to `/users/[id]` (19 routes).

- [ ] **Step 2: Add the table and function to the Supabase project (ask the owner first)**

This changes the live database. Get the owner's go-ahead before running it. Until it runs, the app still works:
- The switcher shows the first firm A to Z.
- Switching shows "Could not switch firm".

Push with the Supabase CLI. The project link lives in the git-ignored `supabase/.temp/`, so a new computer must sign in and link first. The owner runs the sign-in themselves, because it opens a browser:

```
npx supabase login
npx supabase link --project-ref <the project's ref, from the Supabase dashboard URL>
npm run db:push
```

Expected: `db:push` lists `20261025120000_working_firm.sql` and applies it.

Don't paste the SQL into the dashboard's SQL editor instead. That skips the CLI's migration history, and the next `db:push` would try to apply the file again.

- [ ] **Step 3: Try it in the running app**

Start the dev server.
- **Mac or Linux:** `npm run dev`.
- **Windows:** from Git Bash, run `NODE_OPTIONS=--max-http-header-size=65536 npx next dev`. The `dev` script's env syntax doesn't run in the Windows command prompt.

Sign in as the owner and check each item:

1. **The switcher:**
   - The top right shows a firm name with ▾.
   - Tapping it lists both firms. Tapping the other one reloads the page in that firm.
   - The Parties title, Clients and Dashboard all show that firm.
2. **The switch is saved:** sign out and back in, or open the app on another device. It opens in the firm last chosen.
3. **Entry forms (Add an entry):**
   - Vendor bill has no Firm box and says **For Jayraj Infra** (or the current firm).
   - Move money says **Working in …**.
   - In Pay vendor, "Paid from" lists the firm's banks and owner/supervisor cash first, then the other firm's bank under **Other firm: … will owe …**.
4. **Day book:**
   - No firm dropdown.
   - It lists the firm's entries plus cash entries tagged **Common**.
   - The other firm's own entries are absent.
5. **The firm stays with the form:**
   - Open a vendor bill form in one tab. Switch firm in a second tab. Save the first form.
   - The new entry is the first firm's: its serial starts with that firm's code.
6. **Between-firm due:** in AB Infra, pay an AB vendor from Jayraj's bank. The entry's page shows the between-firm lines (AB owes Jayraj).
7. **Supervisor:** sign in as a supervisor. There is no switcher, and site spend and day close work as before.

If anything fails, stop and fix it with a test before going on.

- [ ] **Step 4: Record it in CLAUDE.md**

In `CLAUDE.md`, under "Project status", add this bullet after the Plan 2 bullet:

```markdown
- **Firm switcher (done):** a top-right button sets each person's working firm (stored in `working_firms`, switched via `app_set_my_firm`); every screen and new entry follows it. Spec `docs/superpowers/specs/2026-10-25-firm-switcher-design.md`, plan `docs/superpowers/plans/2026-10-25-firm-switcher.md`. The three-way (AB / Jayraj / Combined) reports come with the reports work.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note the firm switcher in CLAUDE.md"
```

- [ ] **Step 6: Finish the branch**

Use superpowers:finishing-a-development-branch to merge or open a pull request. The pull request description follows the same no-attribution rule as commits.
