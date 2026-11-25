# Bank and Cash, Stage 5: Design Spec

**Date:** 2026-11-24
**Status:** Set aside (owner decision 2026-11-25): finish the tracking system first, forecast later. The page and code were removed; they are in git at commit 5ef58e2. The migration stays, unused.
**Builds on:** stages 1 to 4, and the whole plan: https://claude.ai/artifact/36ZTuWZQZjJe3CayAqvjt5

`/forecast` (Money → Free money), owner and office; the owner also sees all firms. It is worked out from the books and moves nothing (`src/lib/forecast.ts`, `src/app/(app)/forecast/data.ts`).

- **Free money** = held − GST to pay − TDS to deposit − salary due − labour wages due − extra received from clients − owed to our other firms. All firms: also PF cut and rent running, and not what our firms owe each other. Then what is left after party bills due now.
- **Eight weeks:** bills by the oldest first, each due after its party's or client's days of credit (`parties.credit_days`); GST on the 20th, TDS on the 7th, PF on the 15th; salaries and wages on the firm's salary day (`firms.salary_day`, 7 unless changed); site spends as an average week; expected money (`planned_money`: once, weekly or monthly). Overdue is in the first week. A salary counts for the firm that last paid the person.
- **Short:** a firm that runs short is named with what the others could spare, the least they hold from that week on.
- **How close was it:** a forecast kept on a day (`kept_forecasts`) is compared week by week with what was held (`money_at`).

Not in it: bills not typed yet, and money between our own firms, as it is taken as needed. Migration `20261124140000_forecast.sql`.
