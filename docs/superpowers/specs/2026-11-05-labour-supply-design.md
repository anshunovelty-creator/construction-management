# Labour supply section

Owner decisions, 2026-11-05. The client's other business supplies labour, so it gets its own section, apart from AB Infra and Jayraj Infra.

- **Separate list.** Labour supply workers live in their own tables. Nothing here touches the ledger, site costs, vendor balances or either firm's figures. The existing Workers list and Salary page stay for site work.
- **Pay.** A worker has a rate for an 8-hour day: days present × rate, plus OT hours × rate ÷ 8 × the OT rate in Setup (100% to start). Staff have a fixed monthly salary: no OT and nothing cut for a day off. In the running month a staff member's salary builds up by calendar day until today. A rate change starts from a chosen month, so past months do not move.
- **Attendance.** One card per person per month, typed day by day from the paper card: present, absent or not entered, plus OT hours. Workers are paid from it; for staff it is only a record.
- **Deductions.** PF: a percentage (12%) of pay for days worked, not OT, counted up to a ceiling (₹15,000), to the nearest rupee. ESIC: a percentage (0.75%) of full pay, only for someone earning up to a limit (₹21,000), rounded up to the rupee. Each person can be switched on or off for each. Rates are kept from a chosen month, so changing one leaves past months as they were. Other cuts are typed per person with a reason.
- **Money.** Advances, payments and other cuts are entries against a person, dated, cash or bank. Remaining to pay = earned − PF − ESIC − other cuts − advances − payments. Below zero it shows as Extra paid. Words and colours follow the app's money rule: red is money we pay, green is money we get.
- **Logins.** A new Labour login sees only this section and nothing of the firms' money, enforced in the database. Owner and office see it too. Only owner and office change the deduction rates. A money line is removed by owner or office, or by the person who typed it on the same day.

Not in this first version: billing clients for the labour supplied, half days, automatic professional tax, the employer's share of PF and ESIC, and which money account a payment came from.
