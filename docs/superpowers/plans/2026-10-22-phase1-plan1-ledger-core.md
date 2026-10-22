# Phase 1 · Plan 1: Ledger Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested money engine: the Postgres ledger schema with database-enforced safety rules, plus the TypeScript posting rules that turn every Phase 1 form into balanced entries. No UI yet.

**Architecture:** Every money event is one entry with two or more lines that sum to zero (integer paise). The app builds lines in pure TypeScript posting functions (`src/lib/ledger/posting/*`), then hands them to one Postgres function, `post_entry`, which checks balance and period lock, assigns a gapless serial and inserts atomically. Triggers make the ledger append-only, so even a bug or raw SQL can't rewrite history. Tests run against PGlite (real Postgres compiled to WebAssembly, in-process), so no Docker or cloud database is needed.

**Tech Stack:** Node 24, TypeScript 7.0.2, Vitest 5.0.5, @electric-sql/pglite 0.5.11 (Postgres 18 in-process). SQL migrations live in `supabase/migrations/` so the Supabase CLI can apply them unchanged in Plan 2.

**Spec:** `docs/superpowers/specs/2026-10-22-construction-ledger-design.md` (sections 5–7 and 14).

---

## Where this plan fits

Phase 1 (money core) is split into five plans, each ending in working, tested software:

| Plan | Delivers |
|---|---|
| **1. Ledger core (this plan)** | Schema, safety rules, posting rules for every Phase 1 form, tests |
| 2. App shell & masters | Next.js app, Supabase project, login (mobile + password), roles and row-level security, English/Hindi, master-data screens with change history (spec rule 11), opening-balance import from the two Excel files |
| 3. Office forms | Vendor bill, pay vendor (with bill matching), client bill, receipt, transfers, owner capital/drawings, verify queue, period lock, duplicate warnings, vendor and bank statement checks |
| 4. Supervisor app | Installable PWA, offline queue with sync, site cash expense, cash received, day close |
| 5. Reports & dashboard | Day book, cash/bank book, vendor/client/site ledgers, Excel export, owner dashboard, backups, production deploy |

Plans 2–5 are written when their turn comes, against the code this plan produces.

## Conventions (read before starting)

- **Money is integer paise** (`₹1 = 100`). Never use rupee floats. Postgres uses `bigint`.
- **Sign convention:** positive line amount = debit, negative = credit. Every entry's lines sum to exactly 0.
- **Dimensions, not sub-accounts:** a vendor's balance is the sum of `vendor_payable` lines with that `party_id` and `firm_id`. Advances are simply the opposite sign (a negative payable = advance to vendor; a negative receivable = client advance).
- **Common cash:** owner cash and supervisor cash belong to no firm (`firm_id` null, serial series `CM`). Bank accounts belong to a firm.
- **Inter-firm dues are created only when money crosses firms** (one firm's bank pays another firm's bill, or receives another firm's client money). A positive `inter_firm` balance on firm X against firm Y means Y owes X.
- **Actors are UUIDs** for now. Plan 2 links them to Supabase Auth users and adds role checks (for example, only the owner may post into a locked period or cancel a verified entry).
- **Git:** work on branch `feat/ledger-core`. Commit as yourself. The repo hooks reject any Claude/Anthropic author or `Co-Authored-By` line, and you must never pass `--no-verify`.
- Run every command from the repository root.

### Deliberate simplifications vs. the spec (recorded here so later plans don't re-litigate them)

1. Vendor advance and client advance are not separate accounts; they are opposite-sign balances of `vendor_payable` / `client_receivable`. The client-bill "advance recovery" deduction is therefore unnecessary (it nets automatically).
2. Cancelling an entry dated inside a locked period is allowed when a reason is given (the cancel reason doubles as the override reason). Plan 2 restricts this to the owner.
3. Wages payable / worker advance accounts are left for Phase 2 (labour). In Phase 1, supervisors record labour as a `site_cash_expense` with cost head `labour`.

## File structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Tooling; `@/` → `src/` alias |
| `src/lib/money.ts` | Paise type, rupee parsing, Indian formatting, basis-point percentages |
| `src/lib/ledger/types.ts` | Shared types mirroring the Postgres enums: `LineDraft`, `EntryDraft`, `MoneyAccountRef`, `WorkOrderRef` |
| `src/lib/ledger/balance.ts` | Early validation: balanced lines, positive amounts, real dates |
| `src/lib/ledger/inter-firm.ts` | The two lines that record one firm owing another |
| `src/lib/ledger/posting/vendor.ts` | `vendorBill`, `vendorPayment` |
| `src/lib/ledger/posting/client.ts` | `clientBill`, `clientReceipt` |
| `src/lib/ledger/posting/cash.ts` | `siteCashExpense`, `cashTransfer`, `cashCloseDifference`, `ownerCapital`, `ownerDrawing` |
| `src/lib/ledger/posting/opening.ts` | `openingVendorBalance`, `openingMoneyBalance`, `openingClientBalance` |
| `src/lib/ledger/repo.ts` | `Queryable` interface, `postEntry`, `lockBooks` |
| `src/lib/ledger/lifecycle.ts` | `reverseEntry`, `rejectEntry`, `verifyEntry`, `replaceEntry`, `entryStatus` |
| `supabase/migrations/20261022120000_masters.sql` | Firms, sites, parties, work orders, money accounts |
| `supabase/migrations/20261022120100_ledger_tables.sql` | Enums, `entries`, `entry_lines`, `entry_events`, `books_locks`, `serial_counters` |
| `supabase/migrations/20261022120200_posting_functions.sql` | `fy_label`, `next_serial`, `insert_entry`, `post_entry`, `lock_books` |
| `supabase/migrations/20261022120300_ledger_guards.sql` | Append-only, line checks, balanced-at-commit triggers |
| `supabase/migrations/20261022120400_entry_lifecycle.sql` | `reverse_entry`, `reject_entry`, `verify_entry`, `replace_entry`, `entry_status` view |
| `tests/ledger/*.test.ts` + `fixtures.ts` | Pure posting-rule tests (no database) |
| `tests/db/harness.ts` | Migrated PGlite database, seed data, balance helper |
| `tests/db/*.test.ts` | Schema, guard, function and end-to-end tests |

---

### Task 1: Project setup

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/ledger-core
```

Expected: `Switched to a new branch 'feat/ledger-core'`

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "construction-ledger",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@electric-sql/pglite": "0.5.11",
    "@types/node": "26.6.5",
    "typescript": "7.0.2",
    "vitest": "5.0.5"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022", "dom"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "types": ["node"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "tests", "vitest.config.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // PGlite starts a real Postgres in-process; the first start takes a few seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

- [ ] **Step 5: Ignore installed packages**

Add this line to the end of `.gitignore`:

```
node_modules/
```

- [ ] **Step 6: Install and check the tools**

```bash
npm install
npx vitest --version
npx tsc --version
```

Expected: install finishes with `found 0 vulnerabilities`; versions print `vitest/5.0.5 …` and `Version 7.0.2`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: set up TypeScript, Vitest and PGlite"
```

---

### Task 2: Money helpers

**Files:**
- Create: `src/lib/money.ts`
- Test: `tests/ledger/money.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { formatPaise, percentOf, rupeesToPaise } from '@/lib/money';

describe('rupeesToPaise', () => {
  it('parses plain, grouped and symbol-prefixed amounts', () => {
    expect(rupeesToPaise('53118.72')).toBe(5_311_872);
    expect(rupeesToPaise('61,99,578')).toBe(619_957_800);
    expect(rupeesToPaise('₹ 4,938.9')).toBe(493_890);
    expect(rupeesToPaise('-200')).toBe(-20_000);
    expect(rupeesToPaise('0.05')).toBe(5);
  });

  it('rejects anything that is not an exact rupee amount', () => {
    expect(() => rupeesToPaise('')).toThrow('not a valid rupee amount');
    expect(() => rupeesToPaise('12.345')).toThrow('not a valid rupee amount');
    expect(() => rupeesToPaise('abc')).toThrow('not a valid rupee amount');
    expect(() => rupeesToPaise('1e5')).toThrow('not a valid rupee amount');
  });
});

describe('formatPaise', () => {
  it('uses Indian lakh grouping', () => {
    expect(formatPaise(619_957_800)).toBe('₹61,99,578.00');
    expect(formatPaise(5_311_872)).toBe('₹53,118.72');
    expect(formatPaise(-493_890)).toBe('-₹4,938.90');
  });

  it('refuses fractional paise', () => {
    expect(() => formatPaise(10.5)).toThrow('whole number of paise');
  });
});

describe('percentOf', () => {
  it('computes basis-point percentages rounded half-up to the paisa', () => {
    expect(percentOf(100_000_000, 100)).toBe(1_000_000); // 1% of ₹10,00,000
    expect(percentOf(100_000_000, 500)).toBe(5_000_000); // 5%
    expect(percentOf(5_311_872, 100)).toBe(53_119); // 531.1872 -> 531.19
    expect(percentOf(5_311_850, 100)).toBe(53_119); // 531.185 -> 531.19 (half-up)
  });

  it('rejects invalid basis points', () => {
    expect(() => percentOf(100, 10_001)).toThrow('basis points');
    expect(() => percentOf(100, 1.5)).toThrow('basis points');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/ledger/money.test.ts`
Expected: FAIL with `Error: Cannot find package '@/lib/money'`

- [ ] **Step 3: Implement `src/lib/money.ts`**

```ts
/** Money is always an integer number of paise. ₹1 = 100 paise. Never use rupee floats. */
export type Paise = number;

const RUPEES_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export function assertPaise(value: number, label = 'amount'): asserts value is Paise {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a whole number of paise, got ${value}`);
  }
}

/** Parses user input like "53,118.72", "₹ 4938.9" or "-200" into paise. Rejects more than 2 decimals. */
export function rupeesToPaise(input: string): Paise {
  const cleaned = input.replace(/[₹,\s]/g, '');
  const match = RUPEES_PATTERN.exec(cleaned);
  if (!match) {
    throw new Error(`"${input}" is not a valid rupee amount`);
  }
  const [, minus, whole, fraction = ''] = match;
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  assertPaise(paise);
  return minus ? -paise : paise;
}

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** 619957800 -> "₹61,99,578.00" (Indian lakh/crore grouping). */
export function formatPaise(paise: Paise): string {
  assertPaise(paise);
  return INR.format(paise / 100);
}

/** Percentage given in basis points (1% = 100 bp), rounded half-up to the nearest paisa. */
export function percentOf(amount: Paise, basisPoints: number): Paise {
  assertPaise(amount);
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new Error(`basis points must be an integer from 0 to 10000, got ${basisPoints}`);
  }
  const scaled = BigInt(amount) * BigInt(basisPoints);
  const sign = scaled < 0n ? -1n : 1n;
  const rounded = (sign * scaled + 5_000n) / 10_000n;
  return Number(sign * rounded);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/ledger/money.test.ts`
Expected: `Tests  6 passed (6)`

- [ ] **Step 5: Commit**

```bash
git add src/lib/money.ts tests/ledger/money.test.ts
git commit -m "feat: add paise money helpers with Indian formatting"
```

---

### Task 3: Ledger types, balance checks and inter-firm lines

**Files:**
- Create: `src/lib/ledger/types.ts`, `src/lib/ledger/balance.ts`, `src/lib/ledger/inter-firm.ts`
- Test: `tests/ledger/fixtures.ts`, `tests/ledger/balance.test.ts`

- [ ] **Step 1: Create the shared test fixtures `tests/ledger/fixtures.ts`**

```ts
import type { EntryDraft, MoneyAccountRef, WorkOrderRef } from '@/lib/ledger/types';

/** Fake ids for pure posting-rule tests (no database involved). */
export const JI = 'firm-jayraj';
export const AB = 'firm-ab';
export const SVG = 'site-svg';
export const VENDOR = 'party-ansari';
export const CLIENT = 'party-svg-client';
export const WO: WorkOrderRef = { id: 'wo-svg-1', firmId: JI, clientId: CLIENT, siteId: SVG };
export const JI_BANK: MoneyAccountRef = { id: 'acct-ji-bank', kind: 'bank', firmId: JI };
export const AB_BANK: MoneyAccountRef = { id: 'acct-ab-bank', kind: 'bank', firmId: AB };
export const OWNER_CASH: MoneyAccountRef = { id: 'acct-owner', kind: 'owner_cash', firmId: null };
export const RAMESH: MoneyAccountRef = { id: 'acct-ramesh', kind: 'supervisor_cash', firmId: null };

export const sumOf = (draft: EntryDraft) => draft.lines.reduce((total, line) => total + line.amountPaise, 0);
```

- [ ] **Step 2: Write the failing test `tests/ledger/balance.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { assertBalanced, assertDate, assertPositive } from '@/lib/ledger/balance';
import { interFirmLines } from '@/lib/ledger/inter-firm';
import type { EntryDraft } from '@/lib/ledger/types';
import { AB, JI } from './fixtures';

const base: EntryDraft = { id: 'x', entryType: 'cash_transfer', entryDate: '2026-10-22', firmId: null, lines: [] };

describe('assertBalanced', () => {
  it('accepts lines that sum to zero', () => {
    expect(() =>
      assertBalanced({
        ...base,
        lines: [
          { account: 'money', amountPaise: 5, moneyAccountId: 'a' },
          { account: 'money', amountPaise: -5, moneyAccountId: 'b' },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects single-line, unbalanced and zero-amount drafts', () => {
    expect(() => assertBalanced({ ...base, lines: [{ account: 'money', amountPaise: 5, moneyAccountId: 'a' }] })).toThrow(
      'at least two lines',
    );
    expect(() =>
      assertBalanced({
        ...base,
        lines: [
          { account: 'money', amountPaise: 5, moneyAccountId: 'a' },
          { account: 'money', amountPaise: -4, moneyAccountId: 'b' },
        ],
      }),
    ).toThrow('does not balance');
    expect(() =>
      assertBalanced({
        ...base,
        lines: [
          { account: 'money', amountPaise: 0, moneyAccountId: 'a' },
          { account: 'money', amountPaise: 0, moneyAccountId: 'b' },
        ],
      }),
    ).toThrow('zero amount');
  });
});

describe('assertDate and assertPositive', () => {
  it('accepts only real YYYY-MM-DD calendar dates', () => {
    expect(() => assertDate('2026-10-22', 'date')).not.toThrow();
    expect(() => assertDate('2026-02-30', 'date')).toThrow('must be a date');
    expect(() => assertDate('22-10-2026', 'date')).toThrow('must be a date');
  });

  it('accepts only positive whole paise', () => {
    expect(() => assertPositive(1, 'amount')).not.toThrow();
    expect(() => assertPositive(0, 'amount')).toThrow('must be more than zero');
    expect(() => assertPositive(1.5, 'amount')).toThrow('whole number of paise');
  });
});

describe('interFirmLines', () => {
  it('makes the debtor firm owe the creditor firm', () => {
    expect(interFirmLines(JI, AB, 200)).toEqual([
      { account: 'inter_firm', amountPaise: 200, firmId: JI, counterFirmId: AB },
      { account: 'inter_firm', amountPaise: -200, firmId: AB, counterFirmId: JI },
    ]);
  });

  it('adds nothing for the same firm or for common cash', () => {
    expect(interFirmLines(JI, JI, 200)).toEqual([]);
    expect(interFirmLines(null, AB, 200)).toEqual([]);
    expect(interFirmLines(JI, null, 200)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run tests/ledger/balance.test.ts`
Expected: FAIL with `Error: Cannot find package '@/lib/ledger/balance'`

- [ ] **Step 4: Create `src/lib/ledger/types.ts`**

```ts
import type { Paise } from '@/lib/money';

/** Mirrors the Postgres enums in supabase/migrations. Keep both in sync. */
export const COST_HEADS = [
  'material',
  'labour',
  'staff',
  'machine_hire',
  'subcontract',
  'site_overhead',
  'transport',
  'other',
] as const;
export type CostHead = (typeof COST_HEADS)[number];

export type LedgerAccount =
  | 'money'
  | 'vendor_payable'
  | 'client_receivable'
  | 'retention_held'
  | 'security_deposit_held'
  | 'tds_claimable'
  | 'inter_firm'
  | 'site_cost'
  | 'contract_income'
  | 'owner_capital'
  | 'opening_balance'
  | 'cash_short_excess';

/** Entry types the app may post directly. Reversals are created only by the database. */
export type PostableEntryType =
  | 'opening'
  | 'vendor_bill'
  | 'vendor_payment'
  | 'site_cash_expense'
  | 'client_bill'
  | 'client_receipt'
  | 'cash_transfer'
  | 'cash_close_difference'
  | 'owner_capital'
  | 'owner_drawing';

export type MoneyAccountKind = 'bank' | 'owner_cash' | 'supervisor_cash';

/** Positive amount = debit, negative = credit. An entry's lines always sum to zero. */
export interface LineDraft {
  account: LedgerAccount;
  amountPaise: Paise;
  firmId?: string | null;
  counterFirmId?: string;
  moneyAccountId?: string;
  partyId?: string;
  siteId?: string;
  workOrderId?: string;
  costHead?: CostHead;
}

export interface EntryDraft {
  id: string;
  entryType: PostableEntryType;
  /** YYYY-MM-DD */
  entryDate: string;
  /** Firm whose serial series this entry uses; null = common (CM) series. */
  firmId: string | null;
  partyId?: string;
  reference?: string;
  narration?: string;
  lines: LineDraft[];
}

export interface MoneyAccountRef {
  id: string;
  kind: MoneyAccountKind;
  /** Bank accounts belong to a firm; owner and supervisor cash are common (null). */
  firmId: string | null;
}

export interface WorkOrderRef {
  id: string;
  firmId: string;
  clientId: string;
  siteId: string;
}
```

- [ ] **Step 5: Create `src/lib/ledger/balance.ts`**

```ts
import { assertPaise } from '@/lib/money';
import type { EntryDraft } from './types';

/** Same rules the database enforces, checked early so the user gets a clear message. */
export function assertBalanced(draft: EntryDraft): void {
  if (draft.lines.length < 2) {
    throw new Error('an entry needs at least two lines');
  }
  let sum = 0;
  for (const line of draft.lines) {
    assertPaise(line.amountPaise, `${line.account} line`);
    if (line.amountPaise === 0) {
      throw new Error(`${line.account} line has a zero amount`);
    }
    sum += line.amountPaise;
  }
  if (sum !== 0) {
    throw new Error(`entry does not balance: lines sum to ${sum} paise`);
  }
}

/** Throws unless the amount is a positive whole number of paise. */
export function assertPositive(amount: number, label: string): void {
  assertPaise(amount, label);
  if (amount <= 0) {
    throw new Error(`${label} must be more than zero`);
  }
}

/** Throws unless the value is a YYYY-MM-DD calendar date. */
export function assertDate(value: string, label: string): void {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a date like 2026-10-22, got "${value}"`);
  }
}
```

- [ ] **Step 6: Create `src/lib/ledger/inter-firm.ts`**

```ts
import type { Paise } from '@/lib/money';
import type { LineDraft } from './types';

/**
 * Money crossed between firms: `creditorFirmId`'s money was used for `debtorFirmId`,
 * so the debtor now owes the creditor. Returns no lines when no firm boundary is crossed
 * (same firm, or common cash on either side). Positive inter_firm balance = amount owed to that firm.
 */
export function interFirmLines(
  creditorFirmId: string | null,
  debtorFirmId: string | null,
  amountPaise: Paise,
): LineDraft[] {
  if (!creditorFirmId || !debtorFirmId || creditorFirmId === debtorFirmId) {
    return [];
  }
  return [
    { account: 'inter_firm', amountPaise, firmId: creditorFirmId, counterFirmId: debtorFirmId },
    { account: 'inter_firm', amountPaise: -amountPaise, firmId: debtorFirmId, counterFirmId: creditorFirmId },
  ];
}
```

- [ ] **Step 7: Run it and confirm it passes, then type-check**

Run: `npx vitest run tests/ledger/balance.test.ts && npm run typecheck`
Expected: `Tests  6 passed (6)` and no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ledger tests/ledger/fixtures.ts tests/ledger/balance.test.ts
git commit -m "feat: add ledger types, balance checks and inter-firm lines"
```

---

### Task 4: Vendor posting rules

**Files:**
- Create: `src/lib/ledger/posting/vendor.ts`
- Test: `tests/ledger/vendor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import { AB, JI, JI_BANK, OWNER_CASH, SVG, sumOf, VENDOR } from './fixtures';

describe('vendorBill', () => {
  it('charges each item to the site and credits the vendor with the total', () => {
    const draft = vendorBill({
      id: 'bill-1',
      firmId: AB,
      vendorId: VENDOR,
      siteId: SVG,
      billDate: '2026-10-22',
      billNo: ' 4471 ',
      items: [
        { costHead: 'material', amountPaise: 48_300_000 },
        { costHead: 'transport', amountPaise: 1_700_000 },
      ],
    });
    expect(draft).toMatchObject({ id: 'bill-1', entryType: 'vendor_bill', firmId: AB, partyId: VENDOR, reference: '4471' });
    expect(draft.lines).toEqual([
      { account: 'site_cost', amountPaise: 48_300_000, firmId: AB, siteId: SVG, costHead: 'material', partyId: VENDOR },
      { account: 'site_cost', amountPaise: 1_700_000, firmId: AB, siteId: SVG, costHead: 'transport', partyId: VENDOR },
      { account: 'vendor_payable', amountPaise: -50_000_000, firmId: AB, partyId: VENDOR },
    ]);
  });

  it('needs a bill number and positive items', () => {
    const input = { firmId: AB, vendorId: VENDOR, siteId: SVG, billDate: '2026-10-22', billNo: '1', items: [] };
    expect(() => vendorBill(input)).toThrow('at least one item');
    expect(() => vendorBill({ ...input, billNo: ' ', items: [{ costHead: 'material', amountPaise: 1 }] })).toThrow(
      'bill number is required',
    );
    expect(() => vendorBill({ ...input, items: [{ costHead: 'material', amountPaise: -1 }] })).toThrow(
      'must be more than zero',
    );
  });
});

describe('vendorPayment', () => {
  it('pays from the same firm without inter-firm lines', () => {
    const draft = vendorPayment({
      billFirmId: JI, vendorId: VENDOR, from: JI_BANK, amountPaise: 100_000, paymentDate: '2026-10-22', reference: 'UTR1',
    });
    expect(draft.firmId).toBe(JI);
    expect(draft.lines).toHaveLength(2);
    expect(sumOf(draft)).toBe(0);
  });

  it("records that the bill firm owes the paying firm when another firm's bank pays", () => {
    const draft = vendorPayment({
      billFirmId: AB, vendorId: VENDOR, from: JI_BANK, amountPaise: 20_000_000, paymentDate: '2026-10-22', reference: 'UTR9',
    });
    expect(draft.lines).toEqual([
      { account: 'vendor_payable', amountPaise: 20_000_000, firmId: AB, partyId: VENDOR },
      { account: 'money', amountPaise: -20_000_000, firmId: JI, moneyAccountId: JI_BANK.id },
      { account: 'inter_firm', amountPaise: 20_000_000, firmId: JI, counterFirmId: AB },
      { account: 'inter_firm', amountPaise: -20_000_000, firmId: AB, counterFirmId: JI },
    ]);
  });

  it('requires a cheque number or UTR for bank payments but not for cash', () => {
    const input = { billFirmId: JI, vendorId: VENDOR, amountPaise: 100, paymentDate: '2026-10-22' };
    expect(() => vendorPayment({ ...input, from: JI_BANK })).toThrow('cheque number or UTR is required');
    expect(vendorPayment({ ...input, from: OWNER_CASH }).firmId).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/ledger/vendor.test.ts`
Expected: FAIL with `Error: Cannot find package '@/lib/ledger/posting/vendor'`

- [ ] **Step 3: Implement `src/lib/ledger/posting/vendor.ts`**

```ts
import type { Paise } from '@/lib/money';
import { assertBalanced, assertDate, assertPositive } from '../balance';
import { interFirmLines } from '../inter-firm';
import type { CostHead, EntryDraft, LineDraft, MoneyAccountRef } from '../types';

export interface VendorBillInput {
  id?: string;
  firmId: string;
  vendorId: string;
  siteId: string;
  billDate: string;
  billNo: string;
  items: { costHead: CostHead; amountPaise: Paise }[];
  narration?: string;
}

/** A vendor's bill: the site's cost goes up and the firm owes the vendor the total. */
export function vendorBill(input: VendorBillInput): EntryDraft {
  assertDate(input.billDate, 'bill date');
  if (input.billNo.trim() === '') {
    throw new Error('bill number is required');
  }
  if (input.items.length === 0) {
    throw new Error('a bill needs at least one item');
  }
  const costLines: LineDraft[] = input.items.map((item, index) => {
    assertPositive(item.amountPaise, `item ${index + 1} amount`);
    return {
      account: 'site_cost',
      amountPaise: item.amountPaise,
      firmId: input.firmId,
      siteId: input.siteId,
      costHead: item.costHead,
      partyId: input.vendorId,
    };
  });
  const total = costLines.reduce((sum, line) => sum + line.amountPaise, 0);
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'vendor_bill',
    entryDate: input.billDate,
    firmId: input.firmId,
    partyId: input.vendorId,
    reference: input.billNo.trim(),
    narration: input.narration ?? '',
    lines: [
      ...costLines,
      { account: 'vendor_payable', amountPaise: -total, firmId: input.firmId, partyId: input.vendorId },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface VendorPaymentInput {
  id?: string;
  /** The firm that owes the vendor (the firm on the vendor's bills). */
  billFirmId: string;
  vendorId: string;
  from: MoneyAccountRef;
  amountPaise: Paise;
  paymentDate: string;
  /** Cheque number or UTR. Required for bank payments. */
  reference?: string;
  narration?: string;
}

/**
 * Paying a vendor reduces what the bill firm owes. If another firm's bank pays,
 * the bill firm now owes that firm (inter-firm lines). Paying before any bill
 * simply leaves a negative payable, which reports show as an advance to the vendor.
 */
export function vendorPayment(input: VendorPaymentInput): EntryDraft {
  assertDate(input.paymentDate, 'payment date');
  assertPositive(input.amountPaise, 'payment amount');
  const reference = (input.reference ?? '').trim();
  if (input.from.kind === 'bank' && reference === '') {
    throw new Error('cheque number or UTR is required for bank payments');
  }
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'vendor_payment',
    entryDate: input.paymentDate,
    firmId: input.from.firmId,
    partyId: input.vendorId,
    reference,
    narration: input.narration ?? '',
    lines: [
      { account: 'vendor_payable', amountPaise: input.amountPaise, firmId: input.billFirmId, partyId: input.vendorId },
      { account: 'money', amountPaise: -input.amountPaise, firmId: input.from.firmId, moneyAccountId: input.from.id },
      ...interFirmLines(input.from.firmId, input.billFirmId, input.amountPaise),
    ],
  };
  assertBalanced(draft);
  return draft;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/ledger/vendor.test.ts`
Expected: `Tests  5 passed (5)`

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger/posting/vendor.ts tests/ledger/vendor.test.ts
git commit -m "feat: add vendor bill and vendor payment posting rules"
```

---

### Task 5: Client posting rules

**Files:**
- Create: `src/lib/ledger/posting/client.ts`
- Test: `tests/ledger/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { clientBill, clientReceipt } from '@/lib/ledger/posting/client';
import { AB, AB_BANK, CLIENT, JI, JI_BANK, SVG, WO } from './fixtures';

describe('clientBill', () => {
  it('books gross income, TDS and retention as ours, and the net as receivable (spec example)', () => {
    const draft = clientBill({
      workOrder: WO,
      billDate: '2026-10-31',
      billNo: 'RA-1',
      grossPaise: 100_000_000,
      deductions: { tdsPaise: 1_000_000, retentionPaise: 5_000_000 },
    });
    const dims = { firmId: JI, partyId: CLIENT, siteId: SVG, workOrderId: WO.id };
    expect(draft).toMatchObject({ entryType: 'client_bill', firmId: JI, partyId: CLIENT, reference: 'RA-1' });
    expect(draft.lines).toEqual([
      { account: 'client_receivable', amountPaise: 94_000_000, ...dims },
      { account: 'tds_claimable', amountPaise: 1_000_000, ...dims },
      { account: 'retention_held', amountPaise: 5_000_000, ...dims },
      { account: 'contract_income', amountPaise: -100_000_000, ...dims },
    ]);
  });

  it('treats material recovery and penalties as site costs', () => {
    const draft = clientBill({
      workOrder: WO,
      billDate: '2026-10-31',
      billNo: 'RA-2',
      grossPaise: 1_000_000,
      deductions: { materialRecoveryPaise: 200_000, otherPaise: 50_000 },
    });
    expect(draft.lines.filter((l) => l.account === 'site_cost').map((l) => [l.costHead, l.amountPaise])).toEqual([
      ['material', 200_000],
      ['other', 50_000],
    ]);
    expect(draft.lines[0]).toMatchObject({ account: 'client_receivable', amountPaise: 750_000 });
  });

  it('refuses deductions larger than the gross amount', () => {
    expect(() =>
      clientBill({ workOrder: WO, billDate: '2026-10-31', billNo: 'RA-3', grossPaise: 100, deductions: { tdsPaise: 101 } }),
    ).toThrow('deductions are more than the gross amount');
  });
});

describe('clientReceipt', () => {
  it('reduces what the client owes', () => {
    const draft = clientReceipt({
      workOrder: WO, to: JI_BANK, amountPaise: 94_000_000, receiptDate: '2026-11-15', reference: 'UTR5',
    });
    expect(draft.lines).toHaveLength(2);
    expect(draft.lines[1]).toMatchObject({ account: 'client_receivable', amountPaise: -94_000_000 });
  });

  it("makes the receiving firm owe the work-order firm when money lands in the other firm's bank", () => {
    const draft = clientReceipt({ workOrder: WO, to: AB_BANK, amountPaise: 500, receiptDate: '2026-11-15', reference: 'UTR6' });
    expect(draft.lines.slice(2)).toEqual([
      { account: 'inter_firm', amountPaise: 500, firmId: JI, counterFirmId: AB },
      { account: 'inter_firm', amountPaise: -500, firmId: AB, counterFirmId: JI },
    ]);
  });

  it('requires a UTR or cheque number for bank receipts', () => {
    expect(() => clientReceipt({ workOrder: WO, to: JI_BANK, amountPaise: 1, receiptDate: '2026-11-15' })).toThrow(
      'UTR or cheque number is required',
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/ledger/client.test.ts`
Expected: FAIL with `Error: Cannot find package '@/lib/ledger/posting/client'`

- [ ] **Step 3: Implement `src/lib/ledger/posting/client.ts`**

```ts
import type { Paise } from '@/lib/money';
import { assertBalanced, assertDate, assertPositive } from '../balance';
import { interFirmLines } from '../inter-firm';
import type { EntryDraft, LineDraft, MoneyAccountRef, WorkOrderRef } from '../types';

export interface ClientBillDeductions {
  tdsPaise?: Paise;
  retentionPaise?: Paise;
  securityDepositPaise?: Paise;
  /** Client-supplied material charged back to us: a material cost at this site. */
  materialRecoveryPaise?: Paise;
  /** Penalties or other cuts: an "other" cost at this site. */
  otherPaise?: Paise;
}

export interface ClientBillInput {
  id?: string;
  workOrder: WorkOrderRef;
  billDate: string;
  billNo: string;
  grossPaise: Paise;
  deductions: ClientBillDeductions;
  narration?: string;
}

/**
 * A running/stage bill to the client. Income is the gross amount. TDS, retention and
 * security deposit stay ours (held by the client or claimable), so they are assets.
 * Recoveries and penalties are costs. The client owes the rest.
 * An earlier client advance (negative receivable) nets off automatically.
 */
export function clientBill(input: ClientBillInput): EntryDraft {
  assertDate(input.billDate, 'bill date');
  assertPositive(input.grossPaise, 'gross amount');
  if (input.billNo.trim() === '') {
    throw new Error('bill number is required');
  }
  const wo = input.workOrder;
  const woDims = { firmId: wo.firmId, partyId: wo.clientId, siteId: wo.siteId, workOrderId: wo.id };
  const d = input.deductions;
  const deductionLines: LineDraft[] = [];
  const addDeduction = (amount: Paise | undefined, label: string, line: Omit<LineDraft, 'amountPaise'>) => {
    if (amount === undefined || amount === 0) return;
    assertPositive(amount, label);
    deductionLines.push({ ...line, amountPaise: amount });
  };
  addDeduction(d.tdsPaise, 'TDS', { account: 'tds_claimable', ...woDims });
  addDeduction(d.retentionPaise, 'retention', { account: 'retention_held', ...woDims });
  addDeduction(d.securityDepositPaise, 'security deposit', { account: 'security_deposit_held', ...woDims });
  addDeduction(d.materialRecoveryPaise, 'material recovery', {
    account: 'site_cost', ...woDims, costHead: 'material',
  });
  addDeduction(d.otherPaise, 'other deduction', { account: 'site_cost', ...woDims, costHead: 'other' });

  const totalDeductions = deductionLines.reduce((sum, line) => sum + line.amountPaise, 0);
  const net = input.grossPaise - totalDeductions;
  if (net < 0) {
    throw new Error('deductions are more than the gross amount');
  }
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'client_bill',
    entryDate: input.billDate,
    firmId: wo.firmId,
    partyId: wo.clientId,
    reference: input.billNo.trim(),
    narration: input.narration ?? '',
    lines: [
      ...(net > 0 ? [{ account: 'client_receivable' as const, amountPaise: net, ...woDims }] : []),
      ...deductionLines,
      { account: 'contract_income', amountPaise: -input.grossPaise, ...woDims },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface ClientReceiptInput {
  id?: string;
  workOrder: WorkOrderRef;
  to: MoneyAccountRef;
  amountPaise: Paise;
  receiptDate: string;
  /** UTR or cheque number. Required for bank receipts. */
  reference?: string;
  narration?: string;
}

/**
 * Money received from the client. Receiving before a bill leaves a negative receivable
 * (a client advance). If it lands in another firm's bank, that firm now owes the work-order firm.
 */
export function clientReceipt(input: ClientReceiptInput): EntryDraft {
  assertDate(input.receiptDate, 'receipt date');
  assertPositive(input.amountPaise, 'receipt amount');
  const reference = (input.reference ?? '').trim();
  if (input.to.kind === 'bank' && reference === '') {
    throw new Error('UTR or cheque number is required for bank receipts');
  }
  const wo = input.workOrder;
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'client_receipt',
    entryDate: input.receiptDate,
    firmId: input.to.firmId,
    partyId: wo.clientId,
    reference,
    narration: input.narration ?? '',
    lines: [
      { account: 'money', amountPaise: input.amountPaise, firmId: input.to.firmId, moneyAccountId: input.to.id },
      {
        account: 'client_receivable',
        amountPaise: -input.amountPaise,
        firmId: wo.firmId,
        partyId: wo.clientId,
        siteId: wo.siteId,
        workOrderId: wo.id,
      },
      ...interFirmLines(wo.firmId, input.to.firmId, input.amountPaise),
    ],
  };
  assertBalanced(draft);
  return draft;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/ledger/client.test.ts`
Expected: `Tests  6 passed (6)`

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger/posting/client.ts tests/ledger/client.test.ts
git commit -m "feat: add client bill and client receipt posting rules"
```

---

### Task 6: Cash posting rules

**Files:**
- Create: `src/lib/ledger/posting/cash.ts`
- Test: `tests/ledger/cash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  cashCloseDifference,
  cashTransfer,
  ownerCapital,
  ownerDrawing,
  siteCashExpense,
} from '@/lib/ledger/posting/cash';
import { AB_BANK, JI_BANK, OWNER_CASH, RAMESH, SVG } from './fixtures';

describe('siteCashExpense', () => {
  it('records a supervisor site expense as a common site cost (spec example: ₹5,460 labour)', () => {
    const draft = siteCashExpense({
      from: RAMESH, siteId: SVG, costHead: 'labour', amountPaise: 546_000, expenseDate: '2026-10-18', narration: '13 helpers',
    });
    expect(draft.firmId).toBeNull();
    expect(draft.lines).toEqual([
      { account: 'site_cost', amountPaise: 546_000, firmId: null, siteId: SVG, costHead: 'labour' },
      { account: 'money', amountPaise: -546_000, firmId: null, moneyAccountId: RAMESH.id },
    ]);
  });

  it('requires a note', () => {
    expect(() =>
      siteCashExpense({ from: RAMESH, siteId: SVG, costHead: 'other', amountPaise: 100, expenseDate: '2026-10-18', narration: ' ' }),
    ).toThrow('say what the money was spent on');
  });
});

describe('cashTransfer', () => {
  it('moves money between accounts, adding inter-firm lines only across firm banks', () => {
    const toSupervisor = cashTransfer({ from: OWNER_CASH, to: RAMESH, amountPaise: 2_000_000, transferDate: '2026-10-22' });
    expect(toSupervisor.lines).toEqual([
      { account: 'money', amountPaise: 2_000_000, firmId: null, moneyAccountId: RAMESH.id },
      { account: 'money', amountPaise: -2_000_000, firmId: null, moneyAccountId: OWNER_CASH.id },
    ]);
    const firmToFirm = cashTransfer({ from: JI_BANK, to: AB_BANK, amountPaise: 300, transferDate: '2026-10-22' });
    expect(firmToFirm.lines).toHaveLength(4);
  });

  it('refuses a transfer to the same account', () => {
    expect(() => cashTransfer({ from: RAMESH, to: RAMESH, amountPaise: 1, transferDate: '2026-10-22' })).toThrow(
      'same account',
    );
  });
});

describe('cashCloseDifference', () => {
  it('records a shortage when counted cash is less than expected', () => {
    const draft = cashCloseDifference({ account: RAMESH, expectedPaise: 870_000, countedPaise: 750_000, closeDate: '2026-10-21' });
    expect(draft.narration).toBe('Cash short at day close');
    expect(draft.lines).toEqual([
      { account: 'money', amountPaise: -120_000, firmId: null, moneyAccountId: RAMESH.id },
      { account: 'cash_short_excess', amountPaise: 120_000 },
    ]);
  });

  it('records an excess and refuses when nothing differs', () => {
    const excess = cashCloseDifference({ account: RAMESH, expectedPaise: 100, countedPaise: 150, closeDate: '2026-10-21' });
    expect(excess.narration).toBe('Cash excess at day close');
    expect(excess.lines[0]).toMatchObject({ account: 'money', amountPaise: 50 });
    expect(() => cashCloseDifference({ account: RAMESH, expectedPaise: 5, countedPaise: 5, closeDate: '2026-10-21' })).toThrow(
      'nothing to record',
    );
  });
});

describe('owner money', () => {
  it('keeps owner capital and drawings out of site costs', () => {
    expect(ownerCapital({ account: OWNER_CASH, amountPaise: 100, date: '2026-10-22' }).lines).toEqual([
      { account: 'money', amountPaise: 100, firmId: null, moneyAccountId: OWNER_CASH.id },
      { account: 'owner_capital', amountPaise: -100 },
    ]);
    expect(ownerDrawing({ account: OWNER_CASH, amountPaise: 100, date: '2026-10-22' }).lines).toEqual([
      { account: 'owner_capital', amountPaise: 100 },
      { account: 'money', amountPaise: -100, firmId: null, moneyAccountId: OWNER_CASH.id },
    ]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/ledger/cash.test.ts`
Expected: FAIL with `Error: Cannot find package '@/lib/ledger/posting/cash'`

- [ ] **Step 3: Implement `src/lib/ledger/posting/cash.ts`**

```ts
import { assertPaise, type Paise } from '@/lib/money';
import { assertBalanced, assertDate, assertPositive } from '../balance';
import { interFirmLines } from '../inter-firm';
import type { CostHead, EntryDraft, MoneyAccountRef } from '../types';

export interface SiteCashExpenseInput {
  id?: string;
  from: MoneyAccountRef;
  siteId: string;
  costHead: CostHead;
  amountPaise: Paise;
  expenseDate: string;
  /** Vendor/worker party if known; small items can leave it out and use the narration. */
  paidToPartyId?: string;
  narration: string;
}

/** Money spent directly on a site (usually by a supervisor from their cash). */
export function siteCashExpense(input: SiteCashExpenseInput): EntryDraft {
  assertDate(input.expenseDate, 'expense date');
  assertPositive(input.amountPaise, 'expense amount');
  if (input.narration.trim() === '') {
    throw new Error('say what the money was spent on');
  }
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'site_cash_expense',
    entryDate: input.expenseDate,
    firmId: input.from.firmId,
    ...(input.paidToPartyId ? { partyId: input.paidToPartyId } : {}),
    narration: input.narration.trim(),
    lines: [
      {
        account: 'site_cost',
        amountPaise: input.amountPaise,
        firmId: input.from.firmId,
        siteId: input.siteId,
        costHead: input.costHead,
        ...(input.paidToPartyId ? { partyId: input.paidToPartyId } : {}),
      },
      { account: 'money', amountPaise: -input.amountPaise, firmId: input.from.firmId, moneyAccountId: input.from.id },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface CashTransferInput {
  id?: string;
  from: MoneyAccountRef;
  to: MoneyAccountRef;
  amountPaise: Paise;
  transferDate: string;
  reference?: string;
  narration?: string;
}

/**
 * Moving money between our own accounts (bank to owner, owner to supervisor, firm to firm).
 * Not an expense. Bank-to-bank across firms creates an inter-firm due; paying back
 * an existing due is the same transfer in the other direction (it nets off).
 */
export function cashTransfer(input: CashTransferInput): EntryDraft {
  assertDate(input.transferDate, 'transfer date');
  assertPositive(input.amountPaise, 'transfer amount');
  if (input.from.id === input.to.id) {
    throw new Error('cannot transfer to the same account');
  }
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'cash_transfer',
    entryDate: input.transferDate,
    firmId: input.from.firmId,
    reference: (input.reference ?? '').trim(),
    narration: input.narration ?? '',
    lines: [
      { account: 'money', amountPaise: input.amountPaise, firmId: input.to.firmId, moneyAccountId: input.to.id },
      { account: 'money', amountPaise: -input.amountPaise, firmId: input.from.firmId, moneyAccountId: input.from.id },
      ...interFirmLines(input.from.firmId, input.to.firmId, input.amountPaise),
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface CashCloseDifferenceInput {
  id?: string;
  account: MoneyAccountRef;
  expectedPaise: Paise;
  countedPaise: Paise;
  closeDate: string;
  narration?: string;
}

/** Day-close: counted cash differs from what the books expect. Records the shortage or excess. */
export function cashCloseDifference(input: CashCloseDifferenceInput): EntryDraft {
  assertDate(input.closeDate, 'close date');
  assertPaise(input.expectedPaise, 'expected cash');
  assertPaise(input.countedPaise, 'counted cash');
  if (input.countedPaise < 0) {
    throw new Error('counted cash cannot be negative');
  }
  const difference = input.countedPaise - input.expectedPaise;
  if (difference === 0) {
    throw new Error('counted cash matches the books; nothing to record');
  }
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'cash_close_difference',
    entryDate: input.closeDate,
    firmId: input.account.firmId,
    narration: input.narration ?? (difference < 0 ? 'Cash short at day close' : 'Cash excess at day close'),
    lines: [
      { account: 'money', amountPaise: difference, firmId: input.account.firmId, moneyAccountId: input.account.id },
      { account: 'cash_short_excess', amountPaise: -difference },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface OwnerMoneyInput {
  id?: string;
  account: MoneyAccountRef;
  amountPaise: Paise;
  date: string;
  narration?: string;
}

/** Owner puts personal money into the business. */
export function ownerCapital(input: OwnerMoneyInput): EntryDraft {
  assertDate(input.date, 'date');
  assertPositive(input.amountPaise, 'amount');
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'owner_capital',
    entryDate: input.date,
    firmId: input.account.firmId,
    narration: input.narration ?? '',
    lines: [
      { account: 'money', amountPaise: input.amountPaise, firmId: input.account.firmId, moneyAccountId: input.account.id },
      { account: 'owner_capital', amountPaise: -input.amountPaise },
    ],
  };
  assertBalanced(draft);
  return draft;
}

/** Owner takes business money for personal use. Recorded so it never looks like a site cost. */
export function ownerDrawing(input: OwnerMoneyInput): EntryDraft {
  assertDate(input.date, 'date');
  assertPositive(input.amountPaise, 'amount');
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'owner_drawing',
    entryDate: input.date,
    firmId: input.account.firmId,
    narration: input.narration ?? '',
    lines: [
      { account: 'owner_capital', amountPaise: input.amountPaise },
      { account: 'money', amountPaise: -input.amountPaise, firmId: input.account.firmId, moneyAccountId: input.account.id },
    ],
  };
  assertBalanced(draft);
  return draft;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/ledger/cash.test.ts`
Expected: `Tests  7 passed (7)`

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger/posting/cash.ts tests/ledger/cash.test.ts
git commit -m "feat: add site cash, transfer, day-close and owner money posting rules"
```

---

### Task 7: Opening-balance posting rules

**Files:**
- Create: `src/lib/ledger/posting/opening.ts`
- Test: `tests/ledger/opening.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { openingClientBalance, openingMoneyBalance, openingVendorBalance } from '@/lib/ledger/posting/opening';
import { CLIENT, JI, JI_BANK, SVG, VENDOR, WO } from './fixtures';

describe('opening balances', () => {
  it('records what a firm owes a vendor on the opening date', () => {
    const draft = openingVendorBalance({ firmId: JI, vendorId: VENDOR, amountPaise: 133_019_300, asOf: '2026-10-21' });
    expect(draft).toMatchObject({ entryType: 'opening', entryDate: '2026-10-21', firmId: JI, partyId: VENDOR });
    expect(draft.lines).toEqual([
      { account: 'opening_balance', amountPaise: 133_019_300 },
      { account: 'vendor_payable', amountPaise: -133_019_300, firmId: JI, partyId: VENDOR },
    ]);
  });

  it('records opening bank/cash and client balances', () => {
    expect(openingMoneyBalance({ account: JI_BANK, amountPaise: 62_000_000, asOf: '2026-10-21' }).lines).toEqual([
      { account: 'money', amountPaise: 62_000_000, firmId: JI, moneyAccountId: JI_BANK.id },
      { account: 'opening_balance', amountPaise: -62_000_000 },
    ]);
    expect(openingClientBalance({ workOrder: WO, amountPaise: -1_000, asOf: '2026-10-21' }).lines).toEqual([
      { account: 'client_receivable', amountPaise: -1_000, firmId: JI, partyId: CLIENT, siteId: SVG, workOrderId: WO.id },
      { account: 'opening_balance', amountPaise: 1_000 },
    ]);
  });

  it('refuses a zero opening balance', () => {
    expect(() => openingVendorBalance({ firmId: JI, vendorId: VENDOR, amountPaise: 0, asOf: '2026-10-21' })).toThrow(
      'cannot be zero',
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/ledger/opening.test.ts`
Expected: FAIL with `Error: Cannot find package '@/lib/ledger/posting/opening'`

- [ ] **Step 3: Implement `src/lib/ledger/posting/opening.ts`**

```ts
import { assertPaise, type Paise } from '@/lib/money';
import { assertBalanced, assertDate } from '../balance';
import type { EntryDraft, MoneyAccountRef, WorkOrderRef } from '../types';

function assertNonZero(amount: Paise, label: string): void {
  assertPaise(amount, label);
  if (amount === 0) {
    throw new Error(`${label} cannot be zero`);
  }
}

export interface OpeningVendorInput {
  id?: string;
  firmId: string;
  vendorId: string;
  /** Positive = we owe the vendor. Negative = advance already paid to the vendor. */
  amountPaise: Paise;
  asOf: string;
  reference?: string;
}

/** Starting balance with a vendor, e.g. from the 21-Oct-2026 outstanding statements. */
export function openingVendorBalance(input: OpeningVendorInput): EntryDraft {
  assertDate(input.asOf, 'opening date');
  assertNonZero(input.amountPaise, 'opening vendor balance');
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'opening',
    entryDate: input.asOf,
    firmId: input.firmId,
    partyId: input.vendorId,
    reference: input.reference ?? '',
    narration: 'Opening vendor balance',
    lines: [
      { account: 'opening_balance', amountPaise: input.amountPaise },
      { account: 'vendor_payable', amountPaise: -input.amountPaise, firmId: input.firmId, partyId: input.vendorId },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface OpeningMoneyInput {
  id?: string;
  account: MoneyAccountRef;
  amountPaise: Paise;
  asOf: string;
}

/** Starting balance of a bank or cash account. */
export function openingMoneyBalance(input: OpeningMoneyInput): EntryDraft {
  assertDate(input.asOf, 'opening date');
  assertNonZero(input.amountPaise, 'opening money balance');
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'opening',
    entryDate: input.asOf,
    firmId: input.account.firmId,
    narration: 'Opening money balance',
    lines: [
      { account: 'money', amountPaise: input.amountPaise, firmId: input.account.firmId, moneyAccountId: input.account.id },
      { account: 'opening_balance', amountPaise: -input.amountPaise },
    ],
  };
  assertBalanced(draft);
  return draft;
}

export interface OpeningClientInput {
  id?: string;
  workOrder: WorkOrderRef;
  /** Positive = client owes us. Negative = client advance not yet billed. */
  amountPaise: Paise;
  asOf: string;
}

/** Starting amount a client owes on a work order. */
export function openingClientBalance(input: OpeningClientInput): EntryDraft {
  assertDate(input.asOf, 'opening date');
  assertNonZero(input.amountPaise, 'opening client balance');
  const wo = input.workOrder;
  const draft: EntryDraft = {
    id: input.id ?? crypto.randomUUID(),
    entryType: 'opening',
    entryDate: input.asOf,
    firmId: wo.firmId,
    partyId: wo.clientId,
    narration: 'Opening client balance',
    lines: [
      {
        account: 'client_receivable',
        amountPaise: input.amountPaise,
        firmId: wo.firmId,
        partyId: wo.clientId,
        siteId: wo.siteId,
        workOrderId: wo.id,
      },
      { account: 'opening_balance', amountPaise: -input.amountPaise },
    ],
  };
  assertBalanced(draft);
  return draft;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run tests/ledger/opening.test.ts`
Expected: `Tests  3 passed (3)`

- [ ] **Step 5: Commit**

```bash
git add src/lib/ledger/posting/opening.ts tests/ledger/opening.test.ts
git commit -m "feat: add opening balance posting rules"
```

---

### Task 8: Master-data schema and the database test harness

**Files:**
- Create: `supabase/migrations/20261022120000_masters.sql`
- Test: `tests/db/harness.ts`, `tests/db/masters.test.ts`

The harness starts PGlite (2–3 s) once per test file, applies every migration in file-name order, and gives each test a fresh `clone()` (~0.5 s), so tests never share data.

- [ ] **Step 1: Create the harness `tests/db/harness.ts`**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type PGliteInterface } from '@electric-sql/pglite';
import type { EntryDraft, MoneyAccountRef, WorkOrderRef } from '@/lib/ledger/types';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

/** A fresh in-process Postgres with every migration applied, in file-name order. */
export async function createMigratedDb(): Promise<PGlite> {
  const db = new PGlite();
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
  workOrder: WorkOrderRef;
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
    workOrder: { id: workOrderId, firmId: jayraj, clientId: svgClient, siteId: svgSite },
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
```

- [ ] **Step 2: Write the failing test `tests/db/masters.test.ts`**

```ts
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

  it('requires bank accounts to belong to a firm and cash accounts not to', async () => {
    await expect(
      db.query(`insert into money_accounts (kind, name) values ('bank', 'Orphan bank')`),
    ).rejects.toThrow('money_accounts_check');
    await expect(
      db.query(`insert into money_accounts (kind, name, firm_id) values ('owner_cash', 'Firm cash', $1)`, [seed.jayraj]),
    ).rejects.toThrow('money_accounts_check');
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
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run tests/db/masters.test.ts`
Expected: FAIL with `Error: ENOENT: no such file or directory, scandir '…supabase\migrations'`

- [ ] **Step 4: Create `supabase/migrations/20261022120000_masters.sql`**

```sql
-- Master data: firms, sites, parties, work orders, money accounts.

create type party_kind as enum ('vendor', 'client', 'worker', 'staff', 'other');
create type contract_type as enum ('item_rate', 'fixed');
create type money_account_kind as enum ('bank', 'owner_cash', 'supervisor_cash');
create type cost_head as enum (
  'material', 'labour', 'staff', 'machine_hire', 'subcontract', 'site_overhead', 'transport', 'other'
);

create table firms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{2,4}$' and code <> 'CM'),
  name text not null unique check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  location text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table parties (
  id uuid primary key default gen_random_uuid(),
  kind party_kind not null,
  name text not null check (btrim(name) <> ''),
  phone text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, name)
);

create table work_orders (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms (id),
  client_id uuid not null references parties (id),
  site_id uuid not null references sites (id),
  ref text not null check (btrim(ref) <> ''),
  contract_type contract_type not null,
  contract_value_paise bigint check (contract_value_paise is null or contract_value_paise > 0),
  tds_bp integer not null default 0 check (tds_bp between 0 and 10000),
  retention_bp integer not null default 0 check (retention_bp between 0 and 10000),
  security_deposit_bp integer not null default 0 check (security_deposit_bp between 0 and 10000),
  start_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (firm_id, ref)
);

create function work_orders_client_must_be_client() returns trigger
language plpgsql as $$
begin
  if (select kind from parties where id = new.client_id) is distinct from 'client' then
    raise exception 'work order client % is not a party of kind client', new.client_id;
  end if;
  return new;
end $$;

create trigger work_orders_client_kind
  before insert or update on work_orders
  for each row execute function work_orders_client_must_be_client();

create table money_accounts (
  id uuid primary key default gen_random_uuid(),
  kind money_account_kind not null,
  name text not null unique check (btrim(name) <> ''),
  firm_id uuid references firms (id),
  holder_user_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Bank accounts belong to a firm; owner cash and supervisor cash are common.
  check ((kind = 'bank') = (firm_id is not null))
);
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `npx vitest run tests/db/masters.test.ts`
Expected: `Tests  4 passed (4)`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261022120000_masters.sql tests/db/harness.ts tests/db/masters.test.ts
git commit -m "feat: add master-data schema and PGlite test harness"
```

---

### Task 9: Ledger tables, posting functions and `postEntry`

**Files:**
- Create: `supabase/migrations/20261022120100_ledger_tables.sql`, `supabase/migrations/20261022120200_posting_functions.sql`, `src/lib/ledger/repo.ts`
- Test: `tests/db/posting-functions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lockBooks, postEntry } from '@/lib/ledger/repo';
import type { EntryDraft } from '@/lib/ledger/types';
import {
  balanceOf,
  createMigratedDb,
  jayrajBankToOwner,
  OFFICE,
  OWNER,
  ownerToRamesh,
  seedBasics,
  SUPERVISOR,
  type Seed,
} from './harness';

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

describe('serial numbers', () => {
  it('numbers entries per firm series and financial year', async () => {
    expect((await postEntry(db, ownerToRamesh(seed, 100), OFFICE)).serial).toBe('CM/26-27/000001');
    expect((await postEntry(db, ownerToRamesh(seed, 100), OFFICE)).serial).toBe('CM/26-27/000002');
    expect((await postEntry(db, jayrajBankToOwner(seed, 100), OFFICE)).serial).toBe('JI/26-27/000001');
    expect((await postEntry(db, ownerToRamesh(seed, 100, '2026-03-31'), OFFICE)).serial).toBe('CM/25-26/000001');
  });

  it('does not skip a number when a save fails', async () => {
    await postEntry(db, ownerToRamesh(seed, 100), OFFICE);
    const broken = ownerToRamesh(seed, 100);
    broken.lines[0] = { account: 'vendor_payable', amountPaise: 100, firmId: seed.jayraj }; // missing vendor
    await expect(postEntry(db, broken, OFFICE)).rejects.toThrow('line_dimensions');
    expect((await postEntry(db, ownerToRamesh(seed, 100), OFFICE)).serial).toBe('CM/26-27/000002');
  });
});

describe('post_entry', () => {
  it('treats a repeated id as the same entry (offline retry)', async () => {
    const draft = ownerToRamesh(seed, 546_000);
    const first = await postEntry(db, draft, SUPERVISOR);
    const second = await postEntry(db, draft, SUPERVISOR);
    expect(second).toEqual({ id: first.id, serial: first.serial, duplicate: true });
    expect(await balanceOf(db, 'money', { money_account_id: seed.rameshCash.id })).toBe(546_000);
  });

  it('refuses to post reversals directly', async () => {
    const draft = { ...ownerToRamesh(seed, 100), entryType: 'reversal' } as unknown as EntryDraft;
    await expect(postEntry(db, draft, OFFICE)).rejects.toThrow('use reverse_entry or replace_entry');
  });
});

describe('locking the books', () => {
  it('blocks posting on or before the lock date unless a reason is given, and records the override', async () => {
    await lockBooks(db, '2026-10-21', OWNER);
    await expect(postEntry(db, ownerToRamesh(seed, 100, '2026-10-21'), OFFICE)).rejects.toThrow(
      'books are locked through',
    );
    await postEntry(db, ownerToRamesh(seed, 100, '2026-10-22'), OFFICE);

    const late = await postEntry(db, ownerToRamesh(seed, 100, '2026-10-20'), OWNER, 'bill found late');
    const { rows } = await db.query<{ kind: string; reason: string }>(
      'select kind, reason from entry_events where entry_id = $1',
      [late.id],
    );
    expect(rows).toEqual([{ kind: 'lock_override', reason: 'bill found late' }]);
  });

  it('needs a reason to move the lock date back', async () => {
    await lockBooks(db, '2026-10-21', OWNER);
    await expect(lockBooks(db, '2026-09-30', OWNER)).rejects.toThrow('needs a reason');
    await lockBooks(db, '2026-09-30', OWNER, 'correcting September cash');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/db/posting-functions.test.ts`
Expected: FAIL with `Error: Cannot find package '@/lib/ledger/repo'`

- [ ] **Step 3: Create `supabase/migrations/20261022120100_ledger_tables.sql`**

```sql
-- Ledger tables. Entries and lines are append-only; status lives in entry_events.

create type ledger_account as enum (
  'money',
  'vendor_payable',
  'client_receivable',
  'retention_held',
  'security_deposit_held',
  'tds_claimable',
  'inter_firm',
  'site_cost',
  'contract_income',
  'owner_capital',
  'opening_balance',
  'cash_short_excess'
);

create type entry_type as enum (
  'opening',
  'vendor_bill',
  'vendor_payment',
  'site_cash_expense',
  'client_bill',
  'client_receipt',
  'cash_transfer',
  'cash_close_difference',
  'owner_capital',
  'owner_drawing',
  'reversal'
);

create type entry_event_kind as enum ('verified', 'rejected', 'reversed', 'replaced', 'lock_override');

create table serial_counters (
  series text not null,
  fy text not null,
  last_seq integer not null check (last_seq > 0),
  primary key (series, fy)
);

create table entries (
  id uuid primary key,
  serial text not null unique,
  series text not null,
  fy text not null check (fy ~ '^\d{2}-\d{2}$'),
  seq integer not null check (seq > 0),
  entry_type entry_type not null,
  entry_date date not null,
  firm_id uuid references firms (id),
  party_id uuid references parties (id),
  reference text not null default '',
  narration text not null default '',
  reverses_entry_id uuid unique references entries (id),
  replaces_entry_id uuid unique references entries (id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  created_txid bigint not null default txid_current(),
  unique (series, fy, seq),
  check ((entry_type = 'reversal') = (reverses_entry_id is not null)),
  check ((series = 'CM') = (firm_id is null))
);

create table entry_lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null references entries (id),
  line_no smallint not null check (line_no > 0),
  account ledger_account not null,
  amount_paise bigint not null check (amount_paise <> 0),
  firm_id uuid references firms (id),
  counter_firm_id uuid references firms (id),
  money_account_id uuid references money_accounts (id),
  party_id uuid references parties (id),
  site_id uuid references sites (id),
  work_order_id uuid references work_orders (id),
  cost_head cost_head,
  unique (entry_id, line_no),
  -- Each account allows exactly the dimensions it needs, so posting bugs fail loudly.
  constraint line_dimensions check (
    case account
      when 'money' then
        money_account_id is not null and counter_firm_id is null and party_id is null
        and site_id is null and work_order_id is null and cost_head is null
      when 'vendor_payable' then
        firm_id is not null and party_id is not null and counter_firm_id is null
        and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
      when 'inter_firm' then
        firm_id is not null and counter_firm_id is not null and firm_id <> counter_firm_id
        and money_account_id is null and party_id is null and site_id is null
        and work_order_id is null and cost_head is null
      when 'site_cost' then
        site_id is not null and cost_head is not null and counter_firm_id is null and money_account_id is null
      when 'owner_capital' then
        counter_firm_id is null and money_account_id is null and party_id is null
        and site_id is null and work_order_id is null and cost_head is null
      when 'opening_balance' then
        counter_firm_id is null and money_account_id is null and party_id is null
        and site_id is null and work_order_id is null and cost_head is null
      when 'cash_short_excess' then
        counter_firm_id is null and money_account_id is null and party_id is null
        and site_id is null and work_order_id is null and cost_head is null
      -- client_receivable, retention_held, security_deposit_held, tds_claimable, contract_income
      else
        firm_id is not null and party_id is not null and site_id is not null and work_order_id is not null
        and counter_firm_id is null and money_account_id is null and cost_head is null
    end
  )
);

create index entry_lines_entry on entry_lines (entry_id);
create index entry_lines_account_firm_party on entry_lines (account, firm_id, party_id);
create index entry_lines_site on entry_lines (site_id) where site_id is not null;
create index entry_lines_money_account on entry_lines (money_account_id) where money_account_id is not null;

create table entry_events (
  id bigint generated always as identity primary key,
  entry_id uuid not null references entries (id),
  kind entry_event_kind not null,
  actor uuid not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  check (kind = 'verified' or btrim(reason) <> '')
);

create unique index entry_events_one_verified on entry_events (entry_id) where kind = 'verified';
create unique index entry_events_one_terminal on entry_events (entry_id)
  where kind in ('rejected', 'reversed', 'replaced');

create table books_locks (
  id bigint generated always as identity primary key,
  locked_through date not null,
  actor uuid not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
```

- [ ] **Step 4: Create `supabase/migrations/20261022120200_posting_functions.sql`**

```sql
-- Posting functions. The app writes to the ledger only through these.

-- Indian financial year label (April to March): 2026-10-22 -> '26-27', 2027-02-01 -> '26-27'.
create function fy_label(d date) returns text
language sql immutable as $$
  select case
    when extract(month from d) >= 4
      then to_char(d, 'YY') || '-' || to_char(d + interval '1 year', 'YY')
    else to_char(d - interval '1 year', 'YY') || '-' || to_char(d, 'YY')
  end
$$;

-- Gapless: the counter row is locked until commit, and a rollback undoes the increment.
create function next_serial(p_series text, p_fy text) returns integer
language sql as $$
  insert into serial_counters (series, fy, last_seq) values (p_series, p_fy, 1)
  on conflict (series, fy) do update set last_seq = serial_counters.last_seq + 1
  returning last_seq
$$;

create function current_lock_date() returns date
language sql stable as $$
  select locked_through from books_locks order by id desc limit 1
$$;

-- Internal: inserts one entry and its lines. Callers validate the entry type first.
create function insert_entry(p_entry jsonb, p_actor uuid, p_override_reason text) returns jsonb
language plpgsql as $$
declare
  v_id uuid := (p_entry ->> 'id')::uuid;
  v_date date := (p_entry ->> 'entryDate')::date;
  v_firm uuid := nullif(p_entry ->> 'firmId', '')::uuid;
  v_lock date := current_lock_date();
  v_series text;
  v_fy text;
  v_seq integer;
  v_serial text;
  v_line jsonb;
  v_line_no integer := 0;
  v_sum bigint;
begin
  if v_id is null then
    raise exception 'entry id is required';
  end if;
  if v_date is null then
    raise exception 'entry date is required';
  end if;
  if p_actor is null then
    raise exception 'actor is required';
  end if;
  if jsonb_typeof(p_entry -> 'lines') is distinct from 'array' or jsonb_array_length(p_entry -> 'lines') < 2 then
    raise exception 'an entry needs at least two lines';
  end if;

  select coalesce(sum((l ->> 'amountPaise')::bigint), 0)::bigint into v_sum
  from jsonb_array_elements(p_entry -> 'lines') l;
  if v_sum <> 0 then
    raise exception 'entry does not balance: lines sum to % paise', v_sum;
  end if;

  if v_lock is not null and v_date <= v_lock and coalesce(btrim(p_override_reason), '') = '' then
    raise exception 'books are locked through %; a reason is required to post on %', v_lock, v_date;
  end if;

  if v_firm is null then
    v_series := 'CM';
  else
    select code into v_series from firms where id = v_firm;
    if v_series is null then
      raise exception 'unknown firm %', v_firm;
    end if;
  end if;

  v_fy := fy_label(v_date);
  v_seq := next_serial(v_series, v_fy);
  v_serial := v_series || '/' || v_fy || '/' || lpad(v_seq::text, 6, '0');

  insert into entries (
    id, serial, series, fy, seq, entry_type, entry_date, firm_id, party_id,
    reference, narration, reverses_entry_id, replaces_entry_id, created_by
  ) values (
    v_id, v_serial, v_series, v_fy, v_seq, (p_entry ->> 'entryType')::entry_type, v_date, v_firm,
    nullif(p_entry ->> 'partyId', '')::uuid,
    coalesce(p_entry ->> 'reference', ''),
    coalesce(p_entry ->> 'narration', ''),
    nullif(p_entry ->> 'reversesEntryId', '')::uuid,
    nullif(p_entry ->> 'replacesEntryId', '')::uuid,
    p_actor
  );

  for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
    v_line_no := v_line_no + 1;
    insert into entry_lines (
      entry_id, line_no, account, amount_paise, firm_id, counter_firm_id,
      money_account_id, party_id, site_id, work_order_id, cost_head
    ) values (
      v_id, v_line_no,
      (v_line ->> 'account')::ledger_account,
      (v_line ->> 'amountPaise')::bigint,
      nullif(v_line ->> 'firmId', '')::uuid,
      nullif(v_line ->> 'counterFirmId', '')::uuid,
      nullif(v_line ->> 'moneyAccountId', '')::uuid,
      nullif(v_line ->> 'partyId', '')::uuid,
      nullif(v_line ->> 'siteId', '')::uuid,
      nullif(v_line ->> 'workOrderId', '')::uuid,
      nullif(v_line ->> 'costHead', '')::cost_head
    );
  end loop;

  if v_lock is not null and v_date <= v_lock then
    insert into entry_events (entry_id, kind, actor, reason)
    values (v_id, 'lock_override', p_actor, p_override_reason);
  end if;

  return jsonb_build_object('id', v_id, 'serial', v_serial, 'duplicate', false);
end $$;

-- Posts a new entry. Re-posting the same id returns the existing entry (safe offline retries).
create function post_entry(p_entry jsonb, p_actor uuid, p_override_reason text default null) returns jsonb
language plpgsql as $$
declare
  v_existing entries%rowtype;
begin
  select * into v_existing from entries where id = (p_entry ->> 'id')::uuid;
  if found then
    return jsonb_build_object('id', v_existing.id, 'serial', v_existing.serial, 'duplicate', true);
  end if;
  if p_entry ->> 'entryType' = 'reversal'
     or p_entry ? 'reversesEntryId' or p_entry ? 'replacesEntryId' then
    raise exception 'use reverse_entry or replace_entry to cancel or change an entry';
  end if;
  return insert_entry(p_entry, p_actor, p_override_reason);
end $$;

create function lock_books(p_through date, p_actor uuid, p_reason text default '') returns void
language plpgsql as $$
declare
  v_current date := current_lock_date();
begin
  if p_through is null then
    raise exception 'lock date is required';
  end if;
  if v_current is not null and p_through < v_current and coalesce(btrim(p_reason), '') = '' then
    raise exception 'moving the lock back from % to % needs a reason', v_current, p_through;
  end if;
  insert into books_locks (locked_through, actor, reason) values (p_through, p_actor, coalesce(p_reason, ''));
end $$;
```

- [ ] **Step 5: Create `src/lib/ledger/repo.ts`**

```ts
import { assertBalanced } from './balance';
import type { EntryDraft } from './types';

/** Anything that can run a parameterised SQL query: PGlite in tests, a Postgres client in the app. */
export interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface PostResult {
  id: string;
  serial: string;
  /** True when this id was already posted (an offline retry); nothing new was written. */
  duplicate: boolean;
}

export async function postEntry(
  db: Queryable,
  draft: EntryDraft,
  actorId: string,
  overrideReason?: string,
): Promise<PostResult> {
  assertBalanced(draft);
  const { rows } = await db.query<{ result: PostResult }>(
    'select post_entry($1::jsonb, $2::uuid, $3) as result',
    [JSON.stringify(draft), actorId, overrideReason ?? null],
  );
  return rows[0]!.result;
}

export async function lockBooks(db: Queryable, through: string, actorId: string, reason = ''): Promise<void> {
  await db.query('select lock_books($1::date, $2::uuid, $3)', [through, actorId, reason]);
}
```

- [ ] **Step 6: Run it and confirm it passes**

Run: `npx vitest run tests/db/posting-functions.test.ts`
Expected: `Tests  6 passed (6)`

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261022120100_ledger_tables.sql supabase/migrations/20261022120200_posting_functions.sql src/lib/ledger/repo.ts tests/db/posting-functions.test.ts
git commit -m "feat: add ledger tables and post_entry with gapless serials and period lock"
```

---

### Task 10: Database guards

**Files:**
- Create: `supabase/migrations/20261022120300_ledger_guards.sql`
- Test: `tests/db/ledger-guards.test.ts`

These triggers are the last line of defence: they hold even for raw SQL that bypasses `post_entry`.

- [ ] **Step 1: Write the failing test**

```ts
import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { postEntry } from '@/lib/ledger/repo';
import type { EntryDraft } from '@/lib/ledger/types';
import { createMigratedDb, OFFICE, ownerToRamesh, seedBasics, type Seed } from './harness';

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

describe('database guards on the ledger', () => {
  it('rejects an entry whose lines do not sum to zero, even through raw SQL', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          `insert into entries (id, serial, series, fy, seq, entry_type, entry_date, created_by)
           values ($1, 'CM/26-27/000099', 'CM', '26-27', 99, 'cash_transfer', '2026-10-22', $2)`,
          ['11111111-1111-4111-8111-111111111111', OFFICE],
        );
        await tx.query(
          `insert into entry_lines (entry_id, line_no, account, amount_paise, money_account_id)
           values ($1, 1, 'money', 500, $2), ($1, 2, 'money', -400, $3)`,
          ['11111111-1111-4111-8111-111111111111', seed.rameshCash.id, seed.ownerCash.id],
        );
      }),
    ).rejects.toThrow('does not balance');
  });

  it('rejects an entry with a single line', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          `insert into entries (id, serial, series, fy, seq, entry_type, entry_date, created_by)
           values ($1, 'CM/26-27/000098', 'CM', '26-27', 98, 'cash_transfer', '2026-10-22', $2)`,
          ['22222222-2222-4222-8222-222222222222', OFFICE],
        );
      }),
    ).rejects.toThrow('needs at least two lines');
  });

  it('never allows ledger rows to be updated, deleted or truncated', async () => {
    await postEntry(db, ownerToRamesh(seed, 100_000), OFFICE);
    await expect(db.query(`update entry_lines set amount_paise = 1`)).rejects.toThrow('append-only');
    await expect(db.query(`delete from entry_lines`)).rejects.toThrow('append-only');
    await expect(db.query(`update entries set narration = 'changed'`)).rejects.toThrow('append-only');
    await expect(db.query(`delete from entries`)).rejects.toThrow('append-only');
    await expect(db.query(`truncate entry_lines cascade`)).rejects.toThrow('append-only');
  });

  it('refuses extra lines added to an existing entry later', async () => {
    const { id } = await postEntry(db, ownerToRamesh(seed, 100_000), OFFICE);
    await expect(
      db.query(
        `insert into entry_lines (entry_id, line_no, account, amount_paise, money_account_id)
         values ($1, 3, 'money', 100, $2), ($1, 4, 'money', -100, $3)`,
        [id, seed.rameshCash.id, seed.ownerCash.id],
      ),
    ).rejects.toThrow('lines can only be added in the transaction that creates entry');
  });

  it('requires a money line to carry the firm of its bank account', async () => {
    const draft = ownerToRamesh(seed, 100_000);
    draft.lines = [
      { account: 'money', amountPaise: 100_000, firmId: seed.ab, moneyAccountId: seed.jayrajBank.id },
      { account: 'money', amountPaise: -100_000, moneyAccountId: seed.ownerCash.id },
    ];
    await expect(postEntry(db, draft, OFFICE)).rejects.toThrow('money line firm must match');
  });

  it('requires work-order lines to agree with the work order firm, site and client', async () => {
    const draft: EntryDraft = {
      id: crypto.randomUUID(),
      entryType: 'opening',
      entryDate: '2026-10-21',
      firmId: seed.ab,
      lines: [
        {
          account: 'client_receivable',
          amountPaise: 100_000,
          firmId: seed.ab, // the work order belongs to Jayraj
          partyId: seed.svgClient,
          siteId: seed.svgSite,
          workOrderId: seed.workOrder.id,
        },
        { account: 'opening_balance', amountPaise: -100_000 },
      ],
    };
    await expect(postEntry(db, draft, OFFICE)).rejects.toThrow('line does not match work order');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/db/ledger-guards.test.ts`
Expected: `Tests  6 failed (6)` (without the guards, unbalanced inserts, updates and deletes all succeed)

- [ ] **Step 3: Create `supabase/migrations/20261022120300_ledger_guards.sql`**

```sql
-- Database-level guarantees. These hold even if application code has a bug.

-- 1. Ledger history can never be changed or removed.
create function reject_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, lower(tg_op);
end $$;

create trigger entries_append_only before update or delete on entries
  for each row execute function reject_change();
create trigger entries_no_truncate before truncate on entries
  for each statement execute function reject_change();
create trigger entry_lines_append_only before update or delete on entry_lines
  for each row execute function reject_change();
create trigger entry_lines_no_truncate before truncate on entry_lines
  for each statement execute function reject_change();
create trigger entry_events_append_only before update or delete on entry_events
  for each row execute function reject_change();
create trigger entry_events_no_truncate before truncate on entry_events
  for each statement execute function reject_change();
create trigger books_locks_append_only before update or delete on books_locks
  for each row execute function reject_change();
create trigger books_locks_no_truncate before truncate on books_locks
  for each statement execute function reject_change();

-- 2. Lines are checked against the entry and the masters they point to.
create function entry_lines_check() returns trigger
language plpgsql as $$
declare
  v_created_txid bigint;
  v_wo work_orders%rowtype;
begin
  select created_txid into v_created_txid from entries where id = new.entry_id;
  if v_created_txid is distinct from txid_current() then
    raise exception 'lines can only be added in the transaction that creates entry %', new.entry_id;
  end if;

  if new.account = 'money'
     and new.firm_id is distinct from (select firm_id from money_accounts where id = new.money_account_id) then
    raise exception 'money line firm must match the firm of money account %', new.money_account_id;
  end if;

  if new.work_order_id is not null then
    select * into v_wo from work_orders where id = new.work_order_id;
    if new.firm_id is distinct from v_wo.firm_id
       or new.site_id is distinct from v_wo.site_id
       or (new.account <> 'site_cost' and new.party_id is distinct from v_wo.client_id) then
      raise exception 'line does not match work order % (firm, site and client must agree)', new.work_order_id;
    end if;
  end if;

  return new;
end $$;

create trigger entry_lines_check before insert on entry_lines
  for each row execute function entry_lines_check();

-- 3. At commit, every entry must have at least two lines that sum to zero.
create function entries_check_balanced() returns trigger
language plpgsql as $$
declare
  v_count integer;
  v_sum bigint;
begin
  select count(*), coalesce(sum(amount_paise), 0)::bigint into v_count, v_sum
  from entry_lines where entry_id = new.id;
  if v_count < 2 then
    raise exception 'entry % needs at least two lines (has %)', new.serial, v_count;
  end if;
  if v_sum <> 0 then
    raise exception 'entry % does not balance: lines sum to % paise', new.serial, v_sum;
  end if;
  return null;
end $$;

create constraint trigger entries_balanced after insert on entries
  deferrable initially deferred
  for each row execute function entries_check_balanced();
```

- [ ] **Step 4: Run it and confirm it passes, and that earlier database tests still pass**

Run: `npx vitest run tests/db`
Expected: `Tests  16 passed (16)`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261022120300_ledger_guards.sql tests/db/ledger-guards.test.ts
git commit -m "feat: enforce append-only, balanced, consistent ledger lines in the database"
```

---

### Task 11: Entry lifecycle (cancel, reject, verify, replace)

**Files:**
- Create: `supabase/migrations/20261022120400_entry_lifecycle.sql`, `src/lib/ledger/lifecycle.ts`
- Test: `tests/db/entry-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import type { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { entryStatus, rejectEntry, replaceEntry, reverseEntry, verifyEntry } from '@/lib/ledger/lifecycle';
import { postEntry } from '@/lib/ledger/repo';
import {
  balanceOf,
  createMigratedDb,
  OFFICE,
  OWNER,
  ownerToRamesh,
  seedBasics,
  SUPERVISOR,
  type Seed,
} from './harness';

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

describe('cancelling an entry', () => {
  it('posts exactly opposite lines and marks the original cancelled', async () => {
    const posted = await postEntry(db, ownerToRamesh(seed, 2_000_000), OFFICE);
    const reversal = await reverseEntry(db, posted.id, OWNER, 'entered twice');
    expect(reversal.serial).toBe('CM/26-27/000002');
    expect(await balanceOf(db, 'money', { money_account_id: seed.rameshCash.id })).toBe(0);
    expect(await entryStatus(db, posted.id)).toBe('cancelled');
    expect(await entryStatus(db, reversal.id)).toBe('reversal');
    await expect(reverseEntry(db, posted.id, OWNER, 'again')).rejects.toThrow('already cancelled');
    await expect(reverseEntry(db, reversal.id, OWNER, 'undo')).rejects.toThrow('is itself a reversal');
  });

  it('needs a reason', async () => {
    const posted = await postEntry(db, ownerToRamesh(seed, 100), OFFICE);
    await expect(reverseEntry(db, posted.id, OWNER, '  ')).rejects.toThrow('a reason is required');
  });
});

describe('verifying and rejecting', () => {
  it('lets someone else verify an entry, but never the person who entered it', async () => {
    const posted = await postEntry(db, ownerToRamesh(seed, 100), SUPERVISOR);
    expect(await entryStatus(db, posted.id)).toBe('unverified');
    await expect(verifyEntry(db, posted.id, SUPERVISOR)).rejects.toThrow('cannot verify your own entry');
    await verifyEntry(db, posted.id, OFFICE);
    expect(await entryStatus(db, posted.id)).toBe('verified');
    await expect(verifyEntry(db, posted.id, OWNER)).rejects.toThrow('already verified');
  });

  it('rejects an unverified entry by reversing it, but not your own or a verified one', async () => {
    const posted = await postEntry(db, ownerToRamesh(seed, 100), SUPERVISOR);
    await expect(rejectEntry(db, posted.id, SUPERVISOR, 'oops')).rejects.toThrow('cannot reject your own entry');
    await rejectEntry(db, posted.id, OFFICE, 'Ramesh did not receive this cash');
    expect(await entryStatus(db, posted.id)).toBe('cancelled');
    expect(await balanceOf(db, 'money', { money_account_id: seed.rameshCash.id })).toBe(0);

    const verified = await postEntry(db, ownerToRamesh(seed, 100), SUPERVISOR);
    await verifyEntry(db, verified.id, OFFICE);
    await expect(rejectEntry(db, verified.id, OWNER, 'late')).rejects.toThrow('already verified');
  });
});

describe('replacing (editing) an entry', () => {
  it('cancels the old entry and posts the corrected one, linked', async () => {
    const posted = await postEntry(db, ownerToRamesh(seed, 2_000_000), OFFICE);
    const result = await replaceEntry(db, posted.id, ownerToRamesh(seed, 1_500_000), OWNER, 'amount was ₹15,000');
    expect(await balanceOf(db, 'money', { money_account_id: seed.rameshCash.id })).toBe(1_500_000);
    expect(await entryStatus(db, posted.id)).toBe('cancelled');
    expect(await entryStatus(db, result.entry.id)).toBe('unverified');
    const { rows } = await db.query<{ replaces_entry_id: string }>(
      'select replaces_entry_id from entries where id = $1',
      [result.entry.id],
    );
    expect(rows[0]!.replaces_entry_id).toBe(posted.id);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/db/entry-lifecycle.test.ts`
Expected: FAIL with `Error: Cannot find package '@/lib/ledger/lifecycle'`

- [ ] **Step 3: Create `supabase/migrations/20261022120400_entry_lifecycle.sql`**

```sql
-- Entry lifecycle: cancel (reverse), reject, verify, replace, and the derived status.

-- Cancels an entry by posting its exact opposite. p_kind records why: reversed, rejected or replaced.
create function reverse_entry(
  p_entry_id uuid,
  p_actor uuid,
  p_reason text,
  p_kind entry_event_kind default 'reversed',
  p_reversal_id uuid default gen_random_uuid()
) returns jsonb
language plpgsql as $$
declare
  v_original entries%rowtype;
  v_lines jsonb;
  v_result jsonb;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to cancel an entry';
  end if;
  if p_kind not in ('reversed', 'rejected', 'replaced') then
    raise exception 'invalid cancel kind %', p_kind;
  end if;

  select * into v_original from entries where id = p_entry_id;
  if not found then
    raise exception 'entry % not found', p_entry_id;
  end if;
  if v_original.entry_type = 'reversal' then
    raise exception 'entry % is itself a reversal and cannot be cancelled', v_original.serial;
  end if;
  if exists (
    select 1 from entry_events
    where entry_id = p_entry_id and kind in ('rejected', 'reversed', 'replaced')
  ) then
    raise exception 'entry % is already cancelled', v_original.serial;
  end if;

  select jsonb_agg(jsonb_build_object(
    'account', account,
    'amountPaise', -amount_paise,
    'firmId', firm_id,
    'counterFirmId', counter_firm_id,
    'moneyAccountId', money_account_id,
    'partyId', party_id,
    'siteId', site_id,
    'workOrderId', work_order_id,
    'costHead', cost_head
  ) order by line_no) into v_lines
  from entry_lines where entry_id = p_entry_id;

  v_result := insert_entry(
    jsonb_build_object(
      'id', p_reversal_id,
      'entryType', 'reversal',
      'entryDate', v_original.entry_date,
      'firmId', v_original.firm_id,
      'partyId', v_original.party_id,
      'reference', v_original.reference,
      'narration', 'Cancels ' || v_original.serial || ': ' || p_reason,
      'reversesEntryId', v_original.id,
      'lines', v_lines
    ),
    p_actor,
    p_reason
  );

  insert into entry_events (entry_id, kind, actor, reason) values (p_entry_id, p_kind, p_actor, p_reason);
  return v_result;
end $$;

-- Rejecting is for unverified entries, and never by the person who entered them.
create function reject_entry(p_entry_id uuid, p_actor uuid, p_reason text) returns jsonb
language plpgsql as $$
declare
  v_original entries%rowtype;
begin
  select * into v_original from entries where id = p_entry_id;
  if not found then
    raise exception 'entry % not found', p_entry_id;
  end if;
  if v_original.created_by = p_actor then
    raise exception 'you cannot reject your own entry %; cancel it instead', v_original.serial;
  end if;
  if exists (select 1 from entry_events where entry_id = p_entry_id and kind = 'verified') then
    raise exception 'entry % is already verified; cancel it instead of rejecting', v_original.serial;
  end if;
  return reverse_entry(p_entry_id, p_actor, p_reason, 'rejected');
end $$;

create function verify_entry(p_entry_id uuid, p_actor uuid) returns void
language plpgsql as $$
declare
  v_original entries%rowtype;
begin
  select * into v_original from entries where id = p_entry_id;
  if not found then
    raise exception 'entry % not found', p_entry_id;
  end if;
  if v_original.entry_type = 'reversal' then
    raise exception 'reversal % does not need verification', v_original.serial;
  end if;
  if v_original.created_by = p_actor then
    raise exception 'you cannot verify your own entry %', v_original.serial;
  end if;
  if exists (
    select 1 from entry_events
    where entry_id = p_entry_id and kind in ('rejected', 'reversed', 'replaced')
  ) then
    raise exception 'entry % is cancelled', v_original.serial;
  end if;
  if exists (select 1 from entry_events where entry_id = p_entry_id and kind = 'verified') then
    raise exception 'entry % is already verified', v_original.serial;
  end if;
  insert into entry_events (entry_id, kind, actor) values (p_entry_id, 'verified', p_actor);
end $$;

-- Editing = cancel the old entry and post the corrected one, linked, in one transaction.
create function replace_entry(p_old_id uuid, p_new jsonb, p_actor uuid, p_reason text) returns jsonb
language plpgsql as $$
declare
  v_reversal jsonb;
  v_new jsonb;
begin
  if p_new ->> 'entryType' = 'reversal' then
    raise exception 'the replacement cannot be a reversal';
  end if;
  v_reversal := reverse_entry(p_old_id, p_actor, p_reason, 'replaced');
  v_new := insert_entry(p_new || jsonb_build_object('replacesEntryId', p_old_id), p_actor, p_reason);
  return jsonb_build_object('reversal', v_reversal, 'entry', v_new);
end $$;

-- unverified | verified | cancelled | reversal
create view entry_status as
select
  e.id as entry_id,
  case
    when e.entry_type = 'reversal' then 'reversal'
    when exists (
      select 1 from entry_events v
      where v.entry_id = e.id and v.kind in ('rejected', 'reversed', 'replaced')
    ) then 'cancelled'
    when exists (select 1 from entry_events v where v.entry_id = e.id and v.kind = 'verified') then 'verified'
    else 'unverified'
  end as status
from entries e;
```

- [ ] **Step 4: Create `src/lib/ledger/lifecycle.ts`**

```ts
import { assertBalanced } from './balance';
import type { PostResult, Queryable } from './repo';
import type { EntryDraft } from './types';

export type EntryStatus = 'unverified' | 'verified' | 'cancelled' | 'reversal';

/** Cancels an entry by posting its exact opposite. A reason is always required. */
export async function reverseEntry(
  db: Queryable,
  entryId: string,
  actorId: string,
  reason: string,
): Promise<PostResult> {
  const { rows } = await db.query<{ result: PostResult }>(
    'select reverse_entry($1::uuid, $2::uuid, $3) as result',
    [entryId, actorId, reason],
  );
  return rows[0]!.result;
}

/** Rejects someone else's unverified entry (reverses it and marks it rejected). */
export async function rejectEntry(
  db: Queryable,
  entryId: string,
  actorId: string,
  reason: string,
): Promise<PostResult> {
  const { rows } = await db.query<{ result: PostResult }>(
    'select reject_entry($1::uuid, $2::uuid, $3) as result',
    [entryId, actorId, reason],
  );
  return rows[0]!.result;
}

export async function verifyEntry(db: Queryable, entryId: string, actorId: string): Promise<void> {
  await db.query('select verify_entry($1::uuid, $2::uuid)', [entryId, actorId]);
}

/** Edits an entry: cancels the old one and posts the corrected one, linked, in one transaction. */
export async function replaceEntry(
  db: Queryable,
  oldEntryId: string,
  replacement: EntryDraft,
  actorId: string,
  reason: string,
): Promise<{ reversal: PostResult; entry: PostResult }> {
  assertBalanced(replacement);
  const { rows } = await db.query<{ result: { reversal: PostResult; entry: PostResult } }>(
    'select replace_entry($1::uuid, $2::jsonb, $3::uuid, $4) as result',
    [oldEntryId, JSON.stringify(replacement), actorId, reason],
  );
  return rows[0]!.result;
}

export async function entryStatus(db: Queryable, entryId: string): Promise<EntryStatus> {
  const { rows } = await db.query<{ status: EntryStatus }>(
    'select status from entry_status where entry_id = $1::uuid',
    [entryId],
  );
  if (!rows[0]) {
    throw new Error(`entry ${entryId} not found`);
  }
  return rows[0].status;
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `npx vitest run tests/db/entry-lifecycle.test.ts`
Expected: `Tests  5 passed (5)`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261022120400_entry_lifecycle.sql src/lib/ledger/lifecycle.ts tests/db/entry-lifecycle.test.ts
git commit -m "feat: add cancel, reject, verify and replace for entries"
```

---

### Task 12: End-to-end scenario

**Files:**
- Test: `tests/db/scenario.test.ts`

This posts a realistic sequence (opening balances from the 21-Oct statements, AB Infra buying bricks for SVG, Jayraj paying part of it, supervisor cash with a shortage, an RA bill with TDS and retention, and the client's payment) through the real posting rules into the real schema, and checks every balance.

- [ ] **Step 1: Write the test**

```ts
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { percentOf } from '@/lib/money';
import { cashCloseDifference, cashTransfer, siteCashExpense } from '@/lib/ledger/posting/cash';
import { clientBill, clientReceipt } from '@/lib/ledger/posting/client';
import { openingMoneyBalance, openingVendorBalance } from '@/lib/ledger/posting/opening';
import { vendorBill, vendorPayment } from '@/lib/ledger/posting/vendor';
import { postEntry } from '@/lib/ledger/repo';
import { balanceOf, createMigratedDb, OFFICE, seedBasics, SUPERVISOR, type Seed } from './harness';

let db: PGlite;
let seed: Seed;

/**
 * One realistic stretch of business, posted through the real posting rules into the real schema.
 * Figures follow the spec's worked examples and the SVG site report.
 */
beforeAll(async () => {
  db = await createMigratedDb();
  seed = await seedBasics(db);
  const s = seed;

  const drafts = [
    openingVendorBalance({ firmId: s.jayraj, vendorId: s.ansari, amountPaise: 133_019_300, asOf: '2026-10-21' }),
    openingVendorBalance({ firmId: s.ab, vendorId: s.ansari, amountPaise: 85_000_000, asOf: '2026-10-21' }),
    openingMoneyBalance({ account: s.jayrajBank, amountPaise: 62_000_000, asOf: '2026-10-21' }),
    openingMoneyBalance({ account: s.ownerCash, amountPaise: 3_000_000, asOf: '2026-10-21' }),
    // AB Infra buys ₹5,00,000 of bricks for the SVG site.
    vendorBill({
      firmId: s.ab, vendorId: s.ansari, siteId: s.svgSite, billDate: '2026-10-22', billNo: 'BR-101',
      items: [{ costHead: 'material', amountPaise: 50_000_000 }],
    }),
    // Jayraj's bank pays ₹2,00,000 towards that AB Infra bill.
    vendorPayment({
      billFirmId: s.ab, vendorId: s.ansari, from: s.jayrajBank, amountPaise: 20_000_000,
      paymentDate: '2026-10-22', reference: 'UTR-778',
    }),
    // Owner gives Ramesh ₹20,000; Ramesh pays the day's labour; counts ₹240 short at close.
    cashTransfer({ from: s.ownerCash, to: s.rameshCash, amountPaise: 2_000_000, transferDate: '2026-10-22' }),
    siteCashExpense({
      from: s.rameshCash, siteId: s.svgSite, costHead: 'labour', amountPaise: 1_106_000,
      expenseDate: '2026-10-22', narration: 'Labour 22-10 (26 workers)',
    }),
    cashCloseDifference({ account: s.rameshCash, expectedPaise: 894_000, countedPaise: 870_000, closeDate: '2026-10-22' }),
    // RA-1 to the SVG client: ₹10,00,000 gross, TDS 1% and retention 5% from the work order.
    clientBill({
      workOrder: s.workOrder, billDate: '2026-10-31', billNo: 'RA-1', grossPaise: 100_000_000,
      deductions: { tdsPaise: percentOf(100_000_000, 100), retentionPaise: percentOf(100_000_000, 500) },
    }),
    clientReceipt({ workOrder: s.workOrder, to: s.jayrajBank, amountPaise: 94_000_000, receiptDate: '2026-11-15', reference: 'UTR-9001' }),
  ];
  for (const draft of drafts) {
    await postEntry(db, draft, draft.entryType === 'site_cash_expense' ? SUPERVISOR : OFFICE);
  }
});

describe('a realistic sequence of postings', () => {
  it('keeps the whole ledger balanced', async () => {
    const { rows } = await db.query<{ total: number; entries: number }>(
      'select coalesce(sum(amount_paise), 0)::bigint as total, count(distinct entry_id)::int as entries from entry_lines',
    );
    expect(rows[0]).toEqual({ total: 0, entries: 11 });
  });

  it("tracks what each firm owes the shared vendor separately", async () => {
    expect(await balanceOf(db, 'vendor_payable', { firm_id: seed.jayraj, party_id: seed.ansari })).toBe(-133_019_300);
    // AB: −8,50,000 opening − 5,00,000 bill + 2,00,000 paid by Jayraj = −11,50,000
    expect(await balanceOf(db, 'vendor_payable', { firm_id: seed.ab, party_id: seed.ansari })).toBe(-115_000_000);
  });

  it('records that AB Infra owes Jayraj Infra the ₹2,00,000 Jayraj paid', async () => {
    expect(await balanceOf(db, 'inter_firm', { firm_id: seed.jayraj, counter_firm_id: seed.ab })).toBe(20_000_000);
    expect(await balanceOf(db, 'inter_firm', { firm_id: seed.ab, counter_firm_id: seed.jayraj })).toBe(-20_000_000);
  });

  it("puts every firm's cost into the SVG site and gives site profit = billed − costs", async () => {
    const cost = await balanceOf(db, 'site_cost', { site_id: seed.svgSite });
    const income = -(await balanceOf(db, 'contract_income', { site_id: seed.svgSite }));
    expect(cost).toBe(51_106_000); // ₹5,00,000 bricks + ₹11,060 labour
    expect(income - cost).toBe(48_894_000); // ₹4,88,940
  });

  it('tracks bank and supervisor cash exactly', async () => {
    // ₹6,20,000 − ₹2,00,000 + ₹9,40,000
    expect(await balanceOf(db, 'money', { money_account_id: seed.jayrajBank.id })).toBe(136_000_000);
    // ₹20,000 − ₹11,060 − ₹240 short
    expect(await balanceOf(db, 'money', { money_account_id: seed.rameshCash.id })).toBe(870_000);
    expect(await balanceOf(db, 'cash_short_excess')).toBe(24_000);
  });

  it('shows the client has paid the bill, with TDS and retention still ours', async () => {
    const wo = { work_order_id: seed.workOrder.id };
    expect(await balanceOf(db, 'client_receivable', wo)).toBe(0);
    expect(await balanceOf(db, 'tds_claimable', wo)).toBe(1_000_000);
    expect(await balanceOf(db, 'retention_held', wo)).toBe(5_000_000);
  });

  it('starts every entry as unverified', async () => {
    const { rows } = await db.query<{ status: string; n: number }>(
      'select status, count(*)::int as n from entry_status group by status',
    );
    expect(rows).toEqual([{ status: 'unverified', n: 11 }]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/db/scenario.test.ts`
Expected: `Tests  7 passed (7)`. All the pieces already exist, so this should pass first time. If it fails, a posting rule and the schema disagree. Fix the rule or the schema, **never the expected numbers**: they are worked out by hand in the comments.

- [ ] **Step 3: Commit**

```bash
git add tests/db/scenario.test.ts
git commit -m "test: add end-to-end ledger scenario from the spec examples"
```

---

### Task 13: Full check, project notes, push

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run everything**

Run: `npm test && npm run typecheck`
Expected: `Test Files  11 passed (11)`, `Tests  61 passed (61)`, and no type errors.

- [ ] **Step 2: Add a commands section to the end of `CLAUDE.md`**

```markdown
## Commands

- `npm test`: all tests (pure posting rules + database tests on in-process PGlite; no Docker needed)
- `npm run typecheck`: TypeScript check
- Database schema: `supabase/migrations/`, applied in file-name order. Ledger tables are append-only by design; never write a migration that updates or deletes ledger rows.
```

- [ ] **Step 3: Commit and push the branch**

```bash
git add CLAUDE.md
git commit -m "docs: add test and schema commands to CLAUDE.md"
git push -u origin feat/ledger-core
```

Expected: the hooks pass and the branch appears on GitHub.

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch to decide how to merge `feat/ledger-core` into `main`.
