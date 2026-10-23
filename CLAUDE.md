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

## Project status (where we left off: 2026-10-22)

- **What this is:** a construction expense ledger for one owner running two firms (AB Infra, Jayraj Infra) across client sites, so that no rupee goes unaccounted for. Full requirements and every decision made so far are in the approved design spec: `docs/superpowers/specs/2026-10-22-construction-ledger-design.md`.
- **Stack (approved):** Next.js + TypeScript installable web app (PWA, Android), PostgreSQL on Supabase, Vercel. Bill photos are deferred until the owner raises them again.
- **Build plan:** Phase 1 is split into 5 plans. **Plan 1 (ledger core) is done** (2026-10-23) on branch `feat/ledger-core`: `docs/superpowers/plans/2026-10-22-phase1-plan1-ledger-core.md`. 61 tests pass on PGlite (Node 22 works; no Docker needed).
- **Next step:** merge `feat/ledger-core` into `main`, then write Plan 2.
- Source data the owner shared (not in the repo; on the first computer's Desktop): `AB_Infra_Outstanding.xlsx`, `Jayraj_Infra_Outstanding.xlsx`, `SVG SITE WORK REPORT (18-10-2026)1.pdf`. Plan 2's opening-balance import needs the two Excel files, so ask the user to copy them over when that plan starts.

## Commands

- `npm test`: all tests (pure posting rules + database tests on in-process PGlite; no Docker needed)
- `npm run typecheck`: TypeScript check
- Database schema: `supabase/migrations/`, applied in file-name order. Ledger tables are append-only by design; never write a migration that updates or deletes ledger rows.
