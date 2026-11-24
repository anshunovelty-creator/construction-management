# Bank and Cash, Stage 2: Design Spec

**Date:** 2026-11-24
**Status:** Built on the owner's go-ahead (not committed, not on live).
**Builds on:** stage 1 (`2026-11-24-bank-cash-stage1-design.md`) and the whole plan: https://claude.ai/artifact/36ZTuWZQZjJe3CayAqvjt5

## What it does

- **Ansari Enterprise is a firm like the others.** One firm is ticked "Runs Labour payment and owns the AJAX machines" in Setup → Firms (`firms.runs_labour`, one only).
- **Between firms** (`/between`): a running account per pair of firms. Money given or taken, labour supplied, machine rent, one firm paying another's party, and an owner-only opening balance. Each is **one entry with lines in both firms**: each firm's lines add up to zero, and the two dues mirror (`inter_firm`, rules in `src/lib/ledger/posting/firms.ts`). Cancelling undoes both sides.
- **GST and TDS on a supply** are optional, and show in both firms' GST and TDS records. What a firm earns from another is `firm_income`, never mixed with client billing.
- **Labour supplied** (`/labour/supplied`): each worker's days in the month get a place (our firm's site, or an outside customer). One place takes the whole month; several must add up. Confirm puts our own firms' part in the books, one entry per firm and site; confirming again replaces what changed. Outside customers are billed from their client page.
- **Charged rate**: optional per worker, per day or hour like the salary, from a month on (`labour_charge_rates`, closed to the Labour login). Empty means the salary is charged.
- **Where the money went** (`/bankbook/flow`): start + in − out = end, per firm, or all firms with what moved between our firms left out.
- Adding, changing or cancelling an entry in two firms' books needs both firms. Office staff with one firm see only that firm's lines.

## Database rules

Inter-firm lines only on these kinds of entry; both sides must mirror; one opening per pair with nothing before it; one labour supplied per month, firm and site. Migrations `20261124110000_between_firms_types.sql`, `20261124110100_between_firms.sql`.

## Left for later stages

Salary, Ansari wages, site spends, tax payments, machine service and outside machine rent (stage 3); all-firm GST and TDS totals (stage 3).
