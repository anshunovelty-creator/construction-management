# Bank and Cash, Stage 4: Design Spec

**Date:** 2026-11-24
**Status:** Built on the owner's go-ahead (not committed, not on live).
**Builds on:** stages 1 to 3, and the whole plan: https://claude.ai/artifact/36ZTuWZQZjJe3CayAqvjt5

- **Match with bank** (`/bankbook/<bank>/match`): the statement's balance and date, and a tick with its bank date on every line the bank has (`bank_ticks`, `bank_statements`). What the bank should say = opening + lines it had by that date. The difference is worked out afresh on every read (`bank_match`), so a later change shows. A cheque given waits unticked. A ticked entry can't be cancelled until unticked.
- **Cheque returned**: money back to a client (a receipt the other way round) or from a party (a payment the other way round), under Something else.
- **Count cash** (`/bankbook/<cash>/count`): compared with the books at the end of that day; a difference posts `cash_close_difference` against that account. Counts are append-only (`cash_counts`, `app_count_cash`). Whoever holds the cash, or keeps its firm, may count it. The books' figure is not shown before counting.
- **Repeated payments**: the pop-ups ask first when the same account, day, amount and person, or the same cheque/UTR with the same person, is already there; paying people asks when someone was given the same amount that day. Save anyway goes ahead. Sheets do not ask.
- **Close a month** (`/close`, owner): every proof for the month (banks matched and cash counted on its last day, nothing below zero, nothing Not yet known, firms agree, each firm's books add up), then Lock. Opening it again needs a reason.
- **Rounding** has its own account (`round_off`), so cash short or extra is only counted cash.

The old Count the cash form (off the menu) is removed. Migrations `20261124130000_checks_types.sql`, `20261124130100_checks.sql`.
