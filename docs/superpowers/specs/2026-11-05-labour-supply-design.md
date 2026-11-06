# Labour supply section

Owner decisions, 2026-11-06 (replaces the attendance cards, staff, PF and ESIC of 2026-11-05). The client's other business supplies labour, hundreds of people a month, so marking each person's attendance day by day is too much. It gets its own section, apart from AB Infra and Jayraj Infra.

- **Separate list.** Labour supply workers live in their own tables. Nothing here touches the ledger, site costs, vendor balances or either firm's figures. The existing Workers list and Salary page stay for site work.
- **Setup.** A worker has a name and a salary per day. A changed salary counts from a chosen month, so past months do not move.
- **Monthly entry.** One sheet per month, one row per worker, with only these boxes: Present days, OT hours, Advance, Deduction, Addition, Reason, Paid. Present days can pass the days in the month, because a double duty counts as two days.
- **Pay.** Salary = present days × salary per day, plus OT hours × salary per day ÷ 8. To pay = salary + addition − deduction − advance + what the months before left. Below zero it is Extra paid.
- **Ledger.** Each worker has a month-by-month ledger. What one month leaves carries into the next, so extra paid comes off the next salary by itself. A month that ends in extra paid is highlighted. Words and colours follow the app's money rule: red is money we pay, green is money we get.
- **Logins.** A Labour login sees only this section and nothing of the firms' money, enforced in the database. Owner and office see it too.

Not in this version: PF, ESIC, staff on a monthly salary, an OT rate other than a normal hour, opening balances (a first month's Addition or Deduction covers them), billing clients for the labour supplied, and which money account a payment came from. The earlier tables `labour_attendance`, `labour_money` and `labour_settings` stay in the database, unused.
