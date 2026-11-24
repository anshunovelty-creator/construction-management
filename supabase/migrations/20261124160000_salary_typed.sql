-- Labour attendance and pay are typed by hand (owner decision 2026-11-24). A worker's rate in Setup is the price shown on
-- the daily report, which is higher than what the worker is paid, so Salary reads neither the report's attendance nor
-- that rate: days, OT hours and the salary of a worker's month are typed on Salary → Skill. What they are really paid a
-- day is typed there too, and fills the salary in; it carries to later months until changed. The salary is kept as an
-- amount, so changing the pay leaves saved months as they were. Nothing is copied over from
-- the reports, as it would be at the report's price.

create table salary_months (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties (id),
  month date not null check (extract(day from month) = 1),
  -- Can pass the days in the month: a double duty counts as two days.
  days numeric(5, 2) not null default 0 check (days between 0 and 100),
  ot_hours numeric(6, 2) not null default 0 check (ot_hours between 0 and 999),
  -- What they are paid a day; 0 when not typed (the month before's carries on).
  day_pay_paise bigint not null default 0 check (day_pay_paise >= 0),
  salary_paise bigint not null default 0 check (salary_paise >= 0),
  unique (party_id, month)
);

-- Staff earn from the day they were added, or before it when they had been marked present or absent on an earlier report.
-- That earlier day is kept here, once, so nobody's balance changes now that the reports are not read.
alter table parties add column pay_from date;
update parties p set pay_from = d.first_day
from (select party_id, min(work_date) as first_day from labour_day group by 1) d
where d.party_id = p.id and p.kind = 'staff' and d.first_day < p.created_at::date;

create trigger salary_months_worker_kind before insert or update on salary_months
  for each row execute function salary_party_must_be_worker();
create trigger salary_months_audit after insert or update or delete on salary_months
  for each row execute function log_master_change('id');

alter table salary_months enable row level security;
create policy salary_months_all on salary_months for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));
grant select, insert, update, delete on salary_months to authenticated;
