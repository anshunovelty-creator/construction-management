# Bank and Cash, Stage 1: Design Spec

**Date:** 2026-11-24
**Status:** Approved and built 2026-11-24 (not committed, not on live).
**Whole plan (five stages):** https://claude.ai/artifact/36ZTuWZQZjJe3CayAqvjt5
**Builds on:** `2026-10-22-construction-ledger-design.md`. The ledger stays as it is: balanced, undeletable, serial numbered.

## 1. Purpose

Show, for every bank account and every place cash is kept, each rupee in and out with a running balance. After Stage 1:

1. Every account belongs to exactly one firm.
2. Every account can be given an opening balance on screen.
3. Every account has a bankbook.
4. Money can be moved between a firm's own accounts (bank to petty cash, cash to bank, cash to a person).
5. Money nobody recognises is written down at once and sorted out later.
6. Cash can't go below zero, and each firm's books balance alone.

Stage 1 covers AB Infra and Jayraj Infra. It works the same for Ansari Enterprise, which is added as a firm in Stage 2.

**Until Stage 3, the bankbook does not include** salary, Ansari workers' pay, site spends typed on the daily report, machine service, tax and office costs. Its balance is therefore not yet the real balance. It goes to the client only after Stage 4.

## 2. Owner decisions (2026-11-24)

| Question | Decision |
|---|---|
| Can money move between firms? | Yes, as one entry in both books (Stage 2) |
| Shared cash | None. Each firm has its own cash record. |
| Starting balances | An Opening balance button |
| Ansari Enterprise | The third firm. Owns the Labour payment business and the AJAX machines (Stage 2). |
| Ansari taking money | As needed, through a running account per pair of firms (Stage 2) |
| Value of Ansari's labour | Worked out from each worker's daily or hourly rate, with an optional charged rate (Stage 2, section 10) |
| GST and TDS | Firm by firm with a total (Stage 3) |

## 3. Accounts

Setup → Bank and cash accounts stays the place to add them. The `money_accounts` table is reused.

| Kind (stored as) | Shown as | Example |
|---|---|---|
| `bank` | Bank | Jayraj – HDFC current |
| `owner_cash` | Cash box | Jayraj – Office cash |
| `supervisor_cash` | Cash with a person | Jayraj – Cash with Ramesh |

- **Every account has a firm**, including cash with a person. Someone holding cash for two firms has two accounts. UPI counts as the bank it is linked to.
- **Cash with a person** need not be a supervisor with a login (a foreman, or the owner). The login is optional; if given, that person sees this account.
- **Firm and kind are fixed** once the account has an entry. Changing the firm would move its history to another firm.
- **Old shared accounts** ("Owner cash", firmless supervisor cash) can only be switched off. New entries can't use them. All current data is demo data to be wiped before go-live, so nothing is carried over.

## 4. Opening balance

A button on each account's bankbook, owner only.

- Boxes: **Balance on that day** and **Date**. A bank may also be **overdrawn**; cash may not.
- It posts the existing `opening` entry (`openingMoneyBalance`). One live opening per account.
- **Change** cancels the old one with a reason and posts the new one (`app_replace_entry`, already in the database). **Remove** cancels it.
- **Nothing is dated before the opening.** An earlier entry is refused, and so is moving the opening past an existing entry. An account with no opening starts at zero.

## 5. Bankbook

**Money → Bankbook** for owner and office, under Clients in the sidebar.

**`/bankbook`, the list.** The working firm's accounts in three groups (Banks, Cash boxes, Cash with people): name, balance, last entry date. Subtotals and a firm total. The owner also has an **All firms** chip: the same list per firm, with a grand total. A line of its own shows what is **Not yet known**.

**`/bankbook/<account>`, one account.** A month at a time, like the ledger: This month, Last month, any month.

| Date | Entry | From / to | Why | In | Out | Balance |
|---|---|---|---|---|---|---|
| | | Opening balance | | | | 4,20,000 |
| 2 Nov | JI/26-27/000041 | Client A | Received | 6,00,000 | | 10,20,000 |
| 3 Nov | JI/26-27/000042 | Jayraj – Office cash | Moved | | 50,000 | 9,70,000 |
| 5 Nov | JI/26-27/000043 | Cement party | Paid, cheque 000412 | | 2,40,000 | 7,30,000 |
| 7 Nov | JI/26-27/000044 | **Not yet known** | NEFT credit | 25,000 | | 7,55,000 |
| | | Total / Closing | | 6,25,000 | 2,90,000 | 7,55,000 |

- In is green, Out is red. Column lines and zebra rows as everywhere. The entry opens its page.
- Cancelled entries and their reversals are left out, as on party ledgers.
- The closing balance is checked against the `balances` view. If they ever differ, the page says so in red.
- Printable, with the existing print button.

Buttons: **Money in · Money out · Move money · Opening balance** (owner). They appear only when the account is in the working firm; otherwise the page says which firm to switch to.

| Button | Choices in Stage 1 |
|---|---|
| Money in | From a client (picked in the same pop-up) · Owner puts in (owner) · Not yet known |
| Money out | To a party (picked in the same pop-up) · Owner takes out (owner) · Not yet known |
| Move money | To or from this firm's other accounts |

Party Pay, Money received and the sheets keep working where they are. Their entries appear in the bankbook by themselves. Pay also offers cash with a person, which it leaves out today.

**Home.** Each account under "Money we hold" links to its bankbook, and what is Not yet known shows in red. Nothing else on Home changes in Stage 1.

**Supervisors** with a login on a cash account get **My cash**: that bankbook, to read only. Spending from it comes in Stage 3.

## 6. Move money

A pop-up in the style of Money received: From, To, amount (grouped as typed), Today / Yesterday / date, reference, note, and the balance of both accounts before and after.

- Both accounts are in the working firm. The rule exists (`cashTransfer`) and has had no screen.
- It is not a cost or an income. It is one entry that shows in both bankbooks.
- Between firms comes in Stage 2 and is refused until then.

## 7. Not yet known

For a bank credit, a withdrawal or a cash difference nobody can explain yet.

- New ledger account and entry type `not_yet_known`. Lines: the account, and `not_yet_known` (firm only). A note is required.
- It counts in the bankbook at once and shows in red, on the bankbook list and on Home, until sorted.
- **Sort it out** on its entry page: a client's receipt, a payment to a party, owner money (owner), or a move between accounts. The account, amount and date stay fixed. Saving cancels it and posts the right entry, linked, in one step (`app_replace_entry`).
- One unknown line becomes one entry. Splitting one line into many comes in Stage 3.

## 8. Rules the database keeps

| Rule | How |
|---|---|
| Account has a firm | `money_accounts` check: firm set, or switched off. Added `not valid` so old demo rows don't stop the migration. |
| Firm and kind fixed once used | Trigger on `money_accounts` |
| Nothing before the opening; one live opening | Checked when the entry is committed |
| Cash never below zero | Checked when the entry is committed: the day-end balance on the entry's date and every later day. The account is locked during the check, so two payments at once can't both pass. |
| Each firm's lines add up to zero, and every line names a firm | Added to the existing balance check |
| Moves stay inside a firm | Existing rule, plus the firm check above |

- **Checking at commit** covers every way an entry is made (post, replace, sheet rows). In a replace, the cancel and the new entry are judged together.
- **Cancelling** an entry is never refused for going below zero, or a wrong receipt could not be corrected. The bankbook then shows the negative balance in red.
- **Banks** may go below zero (overdraft). It shows in red.
- **Firm on every line:** the posting rules for owner money, openings and cash short or excess put the firm on their second line, which they leave empty today. Old rows are not touched. A reversal copies its original, so reversals are exempt.
- **Future dates** are refused for money entries, in the app.

## 9. Who can do what

| | Owner | Office (their firms) | Supervisor | Labour |
|---|---|---|---|---|
| See bankbooks | All firms | Their firms | Own cash only | None |
| Move money, Not yet known, Sort it out | Yes | Yes | No | No |
| Opening balance, owner money | Yes | No | No | No |
| Add or change accounts | Yes | No | No | No |

`app_assert_can_post` gains `not_yet_known` for office. Its supervisor part, which refuses any line with a firm, changes to allow the firm of their own cash account, so Stage 3 can use it.

## 10. Agreed for Stage 2 (not built here)

**Charged rate.** Each Ansari worker has a paid rate and an optional **charged rate**, each counting from a month on, like today's rate in `labour_rates`. Charged rates get a table of their own, because access rules hide rows and not columns, and the Labour login must not see charged rates or profit.

- Left empty, the charged rate is the paid rate. 0 is not allowed.
- Either may be typed per day or per hour. An hourly rate × 8 is the day's rate.
- Labour supplied = days × charged day rate + OT hours × charged day rate ÷ 8. The worker's pay always uses the paid rate.
- Example: paid ₹500, charged ₹600, 18 days at Jayraj. Jayraj owes ₹10,800, the worker earns ₹9,000, Ansari keeps ₹1,800.
- It is one rate for every firm and customer. A rate per customer is added only if the client needs it.

Days need a place (firm and site, or an outside customer) with a usual place per worker. The running accounts, Machine rent and the firm opening balances are as in the whole plan.

## 11. What is built

**Migrations** (two, because a new enum value can't be used in the transaction that adds it)
1. `not_yet_known` in `ledger_account` and `entry_type`.
2. Account firm check and fixed-firm trigger; `line_dimensions` with `not_yet_known`; the commit checks; `app_assert_can_post`; the view `money_rows` (one row per live money line with its running balance, obeying each person's access).

**Code**

| Where | Change |
|---|---|
| `src/lib/ledger/posting/cash.ts`, `opening.ts` | Firm on second lines; `notYetKnown()` |
| `src/lib/masters/parse.ts`, `registry.ts` | Account rules; forms `move-money`, `not-yet-known` |
| `src/lib/firm.ts`, `masters/options.ts` | The two account lists become one, since no account is shared |
| `src/app/(app)/bankbook/` | List, account page, opening balance |
| `src/components/move-money.tsx` | The pop-up |
| `entries/actions.ts`, `entries/[id]/page.tsx` | Sort it out; future dates refused |
| `layout.tsx`, `board.tsx`, `messages/en.json` | Menu, links, words |
| `scripts/demo-seed.ts`, test fixtures | Cash accounts with firms |

No new packages.

## 12. Tests

- **Posting:** every money form's lines add up to zero per firm; `notYetKnown` both ways.
- **Database:** account with no firm refused; firm change on a used account refused; second opening refused; entry before opening refused; opening moved past an entry refused; cash below zero refused today, and for a back-dated payment that only breaks a later day; a bank allowed below zero; cancelling allowed below zero; replacing judged as one step; line with no firm refused; reversal of an old firmless entry still works.
- **Bankbook:** balance runs across months; cancelled pairs left out; closing equals `balances`; a move shows out of one account and in to the other.
- **Access:** office of AB sees nothing of Jayraj's bankbooks; supervisor sees only their own cash; Labour sees none; office can't post an opening or owner money.
- **By hand, on the practice database:** opening ₹1,00,000 in bank, ₹30,000 moved to cash, ₹10,000 to a person, ₹35,000 cash payment refused, ₹5,000 unknown credit into the bank then sorted to a client. Bank ₹75,000, cash box ₹20,000, person ₹10,000, total ₹1,05,000.

**Done when** every test passes and, for each firm, the total of its bankbooks equals its openings + money in − money out, with moves cancelling to zero (proofs 1 and 5 of the whole plan).

## 13. To approve

1. Cash refuses to go below zero; banks only show red.
2. Office staff can move money and type Not yet known, but not opening balances or owner money.
3. Entries dated in the future are refused. A post-dated cheque is typed on its date until Stage 4 adds cleared dates.
4. Nothing before an account's opening date.
5. Old shared cash accounts can only be switched off.
