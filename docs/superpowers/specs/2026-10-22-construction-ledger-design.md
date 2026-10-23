# Construction Ledger: Design Spec

**Date:** 2026-10-22
**Status:** Draft for owner review
**Repo:** https://github.com/anshunovelty-creator/construction-management

## 1. Purpose

One contractor-owner runs several firms (today **AB Infra** and **Jayraj Infra**) that do construction work at sites for large client companies. Today money is tracked in separate Excel files and daily PDF reports that don't connect. Nobody can answer "what did this site really cost, how much has the client paid, and what do we still owe?"

The system records every rupee once, ties it to a firm, a site and a party, and calculates every balance from those records. **Goal: not a single rupee unaccounted for.**

## 2. What the current files show (analysed 2026-10-22)

| File | Content | Key figures |
|---|---|---|
| `SVG SITE WORK REPORT (18-10-2026)1.pdf` | Jayraj Infra daily site report: work done (measurement × client rate), material consumed, labour by hours, staff, labour colony, daily profit | Work ₹53,118.72 · Material ₹23,668.84 · Labour ₹11,060 (incl. tractor ₹2,000) · Staff ₹4,600 · Colony ₹1,600 · Profit ₹12,189.88 |
| `Jayraj_Infra_Outstanding.xlsx` | Amount owed to 24 vendors, per statements dated 21-Oct-2026; one opening amount + empty payment table per vendor | ₹61,99,578 |
| `AB_Infra_Outstanding.xlsx` | Same template, 9 vendors | ₹16,71,606 |

Gaps found: vendor balances aren't linked to sites; there's no bill-level detail; there's no client-side record (bills, receipts, deductions); hand-typed rates; equipment counted as labour; duplicate serial numbers; no edit history. Shared vendors (Ansari Enterprise, Shree Ambika Marketing) appear in both firms.

## 3. Scope

**In scope:** management ledger for multiple firms and sites; vendor bills and payments; client bills, deductions and receipts; cash and bank accounts including supervisor cash; labour attendance and weekly wages; daily site work and material stock; owner dashboard; English/Hindi UI; offline entry on phones.

**Out of scope (decided):**
- GST, statutory accounts and tax filing. This is a management tool, not Tally.
- Bill/challan photos. **Deferred** by the owner; to be discussed later. Storage choice (Supabase Storage) leaves room for it.
- Native Play Store app. Only if the installable web app's offline mode proves insufficient.
- Material transfers between sites and a central godown. Later, if needed.

## 4. Users and roles

| Role | Device | Can | Cannot |
|---|---|---|---|
| **Owner** | Phone + computer | Everything: all firms and sites; verify; the only one who can change verified entries or lock periods | — |
| **Office staff** | Mainly computer | Enter vendor bills, payments, client bills and receipts for assigned firms; verify entries made by others | Verify their own entries; change verified entries |
| **Supervisor** | Android phone, offline-capable | For assigned sites only: attendance, material arrived and used, work done, cash spends, daily cash close; see own cash balance | See other sites, client rates, profit or firm totals |

Rules: **nobody verifies their own entry**. **Supervisors enter quantities, never rates.** Rates come from the work order or worker record.

Login: the owner creates every account (no self sign-up) and gives staff their login. Users log in with **email + password** (owner decision 2026-10-23; replaces mobile number + password, which needed a paid SMS provider). Each user picks English or Hindi.

## 5. Building blocks

| Block | Meaning |
|---|---|
| **Firm** | One of the owner's companies. Has its own bank accounts and its own balance with each vendor. |
| **Client** | Company the work is for. |
| **Site** | Physical place of work. **Can have costs and work orders from more than one firm.** |
| **Work order** | One firm × one client × one site. Holds terms: fixed value or item rates, advance, TDS %, retention %, security deposit %. Client bills are raised against it. |
| **Party** | Anyone money moves with: vendor (material, machine hire, subcontractor), worker, staff, client. One shared list; balances kept per firm. |
| **Money account** | Each firm's bank accounts (UPI counts as bank); owner cash; one cash account per supervisor. Bank accounts belong to a firm. **Owner cash and supervisor cash are common** (not tied to a firm). |
| **Cost head** | Material, Labour, Staff, Machine hire, Subcontract, Site overheads, Transport, Other. |

## 6. Ledger rules (the "no rupee lost" guarantees)

1. **Balanced entries.** Every money event is one entry with ≥2 lines that sum to exactly zero. Lines carry firm, site, party, cost head and work order as dimensions. Users fill simple forms; the system builds the lines. The **database rejects unbalanced entries**.
2. **Append-only.** Ledger tables accept no UPDATE or DELETE (enforced in the database). An edit creates a reversal plus a replacement entry, linked together. A cancel creates a reversal. Changing a verified entry needs a reason.
3. **Gapless serial numbers** per firm per financial year (Apr–Mar), e.g. `JI/26-27/000123`; common-cash entries use `CM/26-27/…`. They're assigned on the server inside the posting transaction from a locked counter row, so failed saves never burn a number.
4. **Status by events.** `created → verified | rejected`, plus `reversed`/`replaced`, stored as append-only events with who, when and reason. Unverified entries count in totals immediately and are shown separately on the dashboard.
5. **Supervisor daily cash close.** Expected = opening + received − spent. The supervisor enters the counted cash; any difference posts a flagged *cash short/excess* entry.
6. **Period lock.** The owner locks books up to a date. Entries dated on or before it are rejected, except owner overrides, which need a reason that's logged.
7. **Duplicate warnings.** Same firm + vendor + bill number, or same party + amount + date. Saving needs explicit confirmation.
8. **Inter-firm dues only when money crosses** (owner decision). If firm X's bank pays a bill owed by firm Y, the system adds "Y owes X" lines automatically. A purchase stays the buying firm's cost. **Site profit always includes every firm's costs at that site.** A *between-firm settlement* form clears dues.
9. **Exact money.** All amounts are stored as integer **paise** (`bigint`). No floating point anywhere.
10. **Checks against the outside world.** Monthly bank statement balance vs the system's balance, and monthly vendor statement balance vs our bills and payments. Differences show on the dashboard.
11. **Master data audit.** Changes to vendors, rates, work orders and users are logged (old value, new value, who, when).

## 7. Ledger model

Account types: Asset, Liability, Income, Expense, Equity. A fixed set of system accounts, with sub-ledgers via line dimensions (party, firm, site) instead of one account per party:

| Account | Type | Dimensions used |
|---|---|---|
| Each bank account / owner cash / each supervisor cash | Asset | firm (banks only) |
| Vendor payable | Liability | firm, party |
| Vendor advance | Asset | firm, party |
| Client receivable | Asset | firm, party, work order |
| Retention held by client | Asset | firm, party, work order |
| Security deposit held by client | Asset | firm, party, work order |
| TDS deducted (claimable) | Asset | firm, party, work order |
| Client advance | Liability | firm, party, work order |
| Inter-firm receivable / payable | Asset / Liability | firm, counter-firm |
| Wages payable / worker advance | Liability / Asset | party (worker) |
| Site cost | Expense | firm (or common), site, cost head |
| Contract income (billed) | Income | firm, work order, site |
| Owner capital / drawings | Equity | — |
| Opening balance | Equity | — |
| Cash short/excess | Expense | — |

Sign convention: debit = positive paise, credit = negative paise; each entry's lines sum to zero.

**Posting examples:**

| Form | Lines (Dr + / Cr −) |
|---|---|
| Vendor bill ₹5,00,000, AB Infra, SVG site, material | Site cost (AB, SVG, Material) +5,00,000 · Vendor payable (AB, vendor) −5,00,000 |
| Pay vendor ₹2,00,000 from Jayraj bank for an **AB Infra** bill | Vendor payable (AB, vendor) +2,00,000 · Jayraj bank −2,00,000 · Inter-firm receivable (Jayraj←AB) +2,00,000 · Inter-firm payable (AB→Jayraj) −2,00,000 |
| Owner gives supervisor ₹20,000 | Supervisor cash +20,000 · Owner cash −20,000 |
| Supervisor pays labour ₹5,460 at SVG (Phase 1 cash spend) | Site cost (common, SVG, Labour) +5,460 · Supervisor cash −5,460 |
| Client bill RA-1 gross ₹10,00,000, TDS 1%, retention 5% | Client receivable +9,40,000 · TDS claimable +10,000 · Retention held +50,000 · Contract income −10,00,000 |
| Client receipt ₹9,40,000 into Jayraj bank | Jayraj bank +9,40,000 · Client receivable −9,40,000 |

Payment-to-bill matching (which bills a payment settles) and receipt-to-bill matching are stored in allocation tables, so each bill shows unpaid / part-paid / paid.

## 8. Phase 1: Money core

**Setup:** masters (firms, sites, clients, work orders, vendors, money accounts, users, cost heads); **opening balances** imported from the two Excel files as of 21-Oct-2026 (33 vendor balances, totals must equal ₹61,99,578 and ₹16,71,606), plus opening bank, cash, supervisor-cash and client balances. Vendor openings are not split by site ("opening – no site") unless the owner splits them. Vendor names are cleaned during import (e.g. "Briks SVG Site" → the real supplier name, tagged to SVG).

**Forms:** vendor bill · pay vendor (incl. advance) · site cash expense (supervisor) · client bill with deductions · client receipt (incl. advance, short-payment flag) · cash transfer · supervisor day close · owner personal/capital · between-firm settlement · vendor statement check · bank balance check · verify/reject queue · period lock.

**Reports:** day book (all entries for a date) · cash/bank book per money account · vendor ledger per firm (statement-style, exportable to Excel) · client/work-order ledger · site ledger (all costs by head, all firms) · inter-firm balance · unverified entries list.

**Dashboard** (mockup approved 2026-10-22), filterable by date, firm and site:
- *Today:* money received, money paid out (bank vs cash), site cost incurred, unverified amount and count.
- *Position:* owed to vendors (per firm), clients owe us (incl. retention), money in hand (banks, owner, supervisors), between-firm dues.
- *Sites table:* billed, received, costs by head, profit, today's cost. In Phase 1, profit = billed − costs. From Phase 3, a work-done column is added and profit = work done − costs.
- *Needs attention:* cash short/excess, short client payments, vendor/bank statement differences, possible duplicates, retention due, supervisors who haven't closed their day.
- *Biggest vendor balances* (combined across firms) and *supervisor cash today*.
Every number drills down to the entries behind it.

## 9. Phase 2: Labour

- **Workers:** name, phone, type (skilled / helper / staff), rate (hourly or daily) with **effective-date history**, default site.
- **Attendance:** the supervisor marks hours per worker per day (quick buttons 0 / 4 / 8 / custom), offline. Each site-day posts one entry: Site cost (Labour or Staff) Dr, Wages payable (per worker) Cr, at the rate effective that day.
- **Advances:** cash or bank to a worker → Worker advance Dr.
- **Weekly pay sheet:** hours × rate − advances = net payable per worker; payment from supervisor cash or bank.
- Equipment such as the tractor is **Machine hire**, never Labour.

## 10. Phase 3: Site work and material

- **Work order items (BOQ):** description, unit, client rate (hidden from supervisors).
- **Daily work progress:** the supervisor picks an item and enters a measurement (e.g. `4.3*1.3`); the system computes quantity and value. Progress records are **not** ledger entries (to avoid double counting with client bills). They feed "work done" and unbilled work on the dashboard.
- **Material:** receipts at site linked to vendor bill lines; daily consumption by quantity; **stock per site = received − consumed**; valued at weighted-average actual purchase price.
- **Recurring site overheads:** e.g. labour colony ₹1,600/day, auto-posted per site per day once configured.
- **Daily site report:** auto-generated equivalent of today's PDF (work done, material consumed, labour, staff, overheads, profit).

## 11. Offline sync (supervisors)

- Assigned sites, workers, cost heads and vendor names are cached on the phone.
- Each entry gets a **UUID on the phone** at creation and is saved to IndexedDB, then queued.
- The sync endpoint is **idempotent by UUID**: re-sending the same entry never creates a duplicate.
- The app shows a pending-sync count. If the server rejects an entry (e.g. locked period), it comes back to the supervisor as "needs fixing" and is **never dropped silently**.
- Because ledger entries are append-only, there are no edit conflicts. Unsynced entries can be edited on the phone before they sync.

## 12. Tech stack

| Layer | Choice |
|---|---|
| App | **Next.js (App Router) + TypeScript**, Tailwind CSS + shadcn/ui, React Hook Form + Zod |
| Phone | **Installable PWA** (Android): service worker (Serwist), IndexedDB via Dexie for the offline queue |
| Language | next-intl, English + Hindi |
| Database | **PostgreSQL on Supabase** (Mumbai region): Auth (email + password), Row Level Security, Storage (reserved for photos) |
| Schema | SQL migrations in the repo via Supabase CLI |
| Posting logic | TypeScript posting module (form → lines; pure, unit-tested) + one database function `post_entry` that atomically checks balance, period lock and permissions, assigns the serial number and inserts |
| Excel import | One-time Node script for the two outstanding workbooks |
| Hosting | Vercel (Mumbai region) |
| Backups | Supabase daily backups + nightly export to separate storage |
| Tests | Vitest (posting rules), SQL tests (invariants, RLS), Playwright (key flows) |

Running cost: ₹0 while building on free tiers. In production roughly Supabase Pro + Vercel Pro (≈ $45/month; confirm current prices at go-live).

## 13. Error handling

- Form validation in the app (Zod) and again in the database. The database is the final authority.
- Posting is all-or-nothing in one transaction; a failed save leaves nothing behind and burns no serial number.
- Offline failures are surfaced to the user who entered them; nothing is silently discarded.
- Every override (locked period, duplicate confirmation, verified-entry change) needs a reason and is logged.

## 14. Testing

- **Posting rules:** every form type → expected lines; every entry sums to zero; the inter-firm case adds the right four lines.
- **Database invariants:** unbalanced insert rejected; UPDATE/DELETE on ledger tables rejected; locked-period insert rejected; serials gapless after a failed transaction.
- **Permissions:** a supervisor cannot read another site's entries, client rates or profit; office staff cannot verify their own entry.
- **Sync:** the same UUID posted twice → one entry.
- **Import reconciliation:** imported opening balances total exactly ₹61,99,578 (Jayraj) and ₹16,71,606 (AB).
- **Flows (Playwright):** vendor bill → payment → bill shows paid; client bill → short receipt → alert shown.

## 15. Build order

1. **Phase 1, money core** (sections 6–8): replaces both Excel outstanding files with live data.
2. **Phase 2, labour** (section 9).
3. **Phase 3, site work and material** (section 10).

Each phase gets its own implementation plan. The first plan covers Phase 1 only.

## 16. Open items (decide when reached)

- Bill/challan photos (deferred by the owner).
- Exact deduction types per client (beyond TDS, retention, security deposit, advance recovery, material recovery).
- Whether staff are daily-rated (like the PDF's ₹1,300/day) or monthly salaried. Phase 2.
- Whether vendor opening balances should be split by site.
