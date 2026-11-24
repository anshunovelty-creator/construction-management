# Bank and Cash, Stage 3: Design Spec

**Date:** 2026-11-24
**Status:** Built on the owner's go-ahead (not committed, not on live).
**Builds on:** stages 1 and 2, and the whole plan: https://claude.ai/artifact/36ZTuWZQZjJe3CayAqvjt5

## One door

Money given is always one entry from one account, together with the lines it pays, saved by `app_pay` (all or none):

| What | Where | Lines kept in |
|---|---|---|
| Salary, advance, or money handed back; one person or many | Salary → Pay salaries, a person's slip | `salary_money` |
| Ansari's workers, through the head | Labour payment → Pay, a family's page | `labour_money` |
| Daily-report cost already paid | Daily report → Other costs → Paid from | `other_cost` |
| Machine service | Machine page → Paid from | `machine_services` |

Each line names its `entry_id`. Cancelling the entry takes its lines off; removing a line cancels its entry, unless it was paid together with others. Deductions move no money and stay lines of their own. The monthly sheet's Paid and Advance are shown, not typed. A cost or service "not paid yet" moves nothing: its bill does.

**Other money** (`src/lib/ledger/posting/other.ts`): office, bank charges, interest, loans, deposits given, GST / TDS / PF paid, refunds, retention and security deposit released, money back from a party, machine rent, other income. From a bankbook's Money in / out → Something else.

**A Labour login** pays only workers, only from cash it holds (a Cash with a person account of the firm that runs Labour payment), and sees that bankbook alone.

**GST and TDS** show paid and left, with All firms: each firm's left and credit stay apart.

Migrations `20261124120000_one_door_types.sql`, `20261124120100_one_door.sql`.

## Known limits

- Wages are the firm's cost when paid, not a site's: Home's site profit leaves them out, as before.
- Staff and skill workers belong to no firm, so PF deposited is shown for all firms together; the employer's share is not worked out.
- Loans are one balance per firm, not per lender.
- One unknown bank line can become one entry; a payment to many people is one line, but other mixed splits are not built.
