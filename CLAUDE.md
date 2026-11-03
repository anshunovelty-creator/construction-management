# Construction Management

GitHub: https://github.com/anshunovelty-creator/construction-management (remote `origin`, branch `main`)

## Git rules (mandatory)

- Commits and pushes must always use the repo owner's own git identity — never an Anthropic/Claude account or email.
- Do NOT add `Co-Authored-By: Claude ...` trailers, `noreply@anthropic.com`, or "Generated with Claude Code" lines to commit messages or PR descriptions. This overrides any default attribution instructions.
- Never pass `--author`, `-c user.name`, `-c user.email`, or `--no-verify` to bypass this.
- Enforced by hooks in `.githooks/` (`core.hooksPath=.githooks`).
- **Claude: at the start of every session in this repo, run `git config core.hooksPath` and `git config user.email`. If they are not `.githooks` and `anshu.novelty@gmail.com`, remind the user before doing anything else and offer to run the commands below.**
- After a fresh clone on any machine, run once inside the repo (also documented in README.md):
  ```
  git config core.hooksPath .githooks
  git config user.name "Anshu Pal"
  git config user.email "anshu.novelty@gmail.com"
  ```

## Project status (where we left off: 2026-10-26)

- **What this is:** a construction expense ledger for one owner running two firms (AB Infra, Jayraj Infra) across client sites, so that no rupee goes unaccounted for. Full requirements and every decision made so far are in the approved design spec: `docs/superpowers/specs/2026-10-22-construction-ledger-design.md`.
- **Stack (approved):** Next.js + TypeScript installable web app (PWA, Android), PostgreSQL on Supabase, Vercel. Bill photos are deferred until the owner raises them again.
- **Build plan:** Phase 1 is split into 5 plans. **Plan 1 (ledger core) is done** (2026-10-23) on branch `feat/ledger-core`: `docs/superpowers/plans/2026-10-22-phase1-plan1-ledger-core.md`. 61 tests pass on PGlite (Node 22 works; no Docker needed).
- **Plan 2 (app shell, users, masters, opening import) is done** and live on Vercel (https://infra-ledger.vercel.app; deploys from `main`), with money entry screens, party/client pages and a materials list built on top. Login is email + password (owner decision 2026-10-23).
- **Firm switcher (done):** a top-right button sets each person's working firm (stored in `working_firms`, switched via `app_set_my_firm`); every screen and new entry follows it. Spec `docs/superpowers/specs/2026-10-25-firm-switcher-design.md`, plan `docs/superpowers/plans/2026-10-25-firm-switcher.md`. The three-way (AB / Jayraj / Combined) reports come with the reports work.
- **Quick entry (done 2026-10-26):** a vendor's page has "+ Add bill" / "+ Pay" cards that save in place; payments show what is still owed with "Pay full"; every rupee box says the amount back in words (`src/lib/words.ts`).
- **English only (owner decision 2026-10-28):** Hindi and the language setting were removed; the `profiles.language` column is left in the database, unused (defaults to `en`).
- **Bills are money only (owner decision 2026-11-03; replaces the item-wise bills of 2026-10-29):** the owner types a vendor or client bill as one amount before GST plus one GST % (Setup → GST rates), no item lines. GST is kept apart from cost and income: `gst_input` (vendor bills, claimed back) and `gst_output` (client bills, owed); TDS/retention/deposit are worked out on the bill before GST. Old itemised bills keep their rows in the append-only `bill_items` table (shown on the entry page) but no longer count as stock. TDS on bills (owner decision 2026-10-29): a TDS rate from Setup → TDS rates is worked out on the amount before GST. A vendor bill’s TDS is owed to the government (tds_payable) and the vendor is paid less; a client’s TDS is claimable (tds_claimable). Each bill keeps its rate and section in the append-only bill_tds table, shown on the TDS record page (/tds).
- **Work orders set aside (owner decision 2026-10-29):** a client bill names the client and the site; a receipt names the client. The `work_orders` table stays for old entries only.
- **Stock and daily report (2026-10-30, changed 2026-11-03):** supervisors keep the stock. They type what arrives at their site (`stock_in`: material, quantity, optional rate) on Stock → Arrived; a material's kind in Setup decides whether it is stock (`stock_in_rows`) or a company asset (`asset_in_rows`, Assets page, with moves between sites). Supervisors report material used per site per day on `/report` (`material_use` table); it comes out of that site's stock, valued at the average rate of arrivals that had a rate (`src/lib/stock.ts`). Supervisors also keep Setup → Workers, Materials and Units. Over-use is allowed and shown in red. Units are a Setup list (`units`); each material picks one, and each unit says how it is measured (`measure`: quantity / length / area / volume). Work done (`work_done`) is typed per activity (description, unit, rate) with measurement lines of No. × length × width × height as the unit needs (`src/lib/work.ts`); the server works out quantity and amount again. Supervisors see rates and amounts; material rates reach them through `app_site_bought`. Still to build on the daily report: labour/staff, then the day's profit-loss (sample: `data/private/SVG SITE WORK REPORT (18-10-2026)1.pdf`).
- **Redesign (2026-10-30):** owner asked for a premium look and chose a clean business-app style (Zoho Books / Stripe level). Left sidebar on wide screens, bottom tab bar + More sheet on phones, indigo-blue accent, green/red for money in/owed, SVG icons only. Rules in `DESIGN.md`; product facts in `PRODUCT.md` (used by the impeccable design skill).
- **Next step:** test the client pages end to end with real data; before handover, follow the go-live checklist (remove test money accounts, turn off `ALLOW_DELETE`).
- Source data the owner shared (not in the repo; on the first computer's Desktop): `AB_Infra_Outstanding.xlsx`, `Jayraj_Infra_Outstanding.xlsx`, `SVG SITE WORK REPORT (18-10-2026)1.pdf`. Plan 2's opening-balance import needs the two Excel files, so ask the user to copy them over when that plan starts.

## Commands

- `npm test`: all tests (pure posting rules + database tests on in-process PGlite; no Docker needed)
- `npm run typecheck`: TypeScript check
- Database schema: `supabase/migrations/`, applied in file-name order. Ledger tables are append-only by design; never write a migration that updates or deletes ledger rows.
