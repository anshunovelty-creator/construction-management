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
- **Plan 2 (app shell, users, masters, opening import) is done** and live on Vercel (https://construction-management.vercel.app), with money entry screens, party/client pages and a materials list built on top. Login is email + password (owner decision 2026-10-23).
- **Firm switcher (done):** a top-right button sets each person's working firm (stored in `working_firms`, switched via `app_set_my_firm`); every screen and new entry follows it. Spec `docs/superpowers/specs/2026-10-25-firm-switcher-design.md`, plan `docs/superpowers/plans/2026-10-25-firm-switcher.md`. The three-way (AB / Jayraj / Combined) reports come with the reports work.
- **Quick entry (done 2026-10-26):** a vendor's page has "+ Add bill" / "+ Pay" cards that save in place; payments show what is still owed with "Pay full"; every rupee box says the amount back in words (English/Hindi, `src/lib/words.ts`).
- **Next step:** test the client pages end to end with real data; before handover, follow the go-live checklist (remove test money accounts, turn off `ALLOW_DELETE`).
- Source data the owner shared (not in the repo; on the first computer's Desktop): `AB_Infra_Outstanding.xlsx`, `Jayraj_Infra_Outstanding.xlsx`, `SVG SITE WORK REPORT (18-10-2026)1.pdf`. Plan 2's opening-balance import needs the two Excel files, so ask the user to copy them over when that plan starts.

## Commands

- `npm test`: all tests (pure posting rules + database tests on in-process PGlite; no Docker needed)
- `npm run typecheck`: TypeScript check
- Database schema: `supabase/migrations/`, applied in file-name order. Ledger tables are append-only by design; never write a migration that updates or deletes ledger rows.
