-- Labour supply, one line per person per month: days and OT typed as totals, with the month's money beside them.
-- Replaces the day-by-day cards, the dated money lines and PF/ESIC/OT rates: labour_attendance, labour_money and
-- labour_settings stay in the database, unused. See docs/superpowers/specs/2026-11-05-labour-supply-design.md.

create table labour_months (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references labour_workers (id),
  month date not null check (extract(day from month) = 1),
  -- Can pass the days in the month: a double duty counts as two days.
  present_days numeric(5, 2) not null default 0 check (present_days between 0 and 100),
  ot_hours numeric(6, 2) not null default 0 check (ot_hours between 0 and 999),
  advance_paise bigint not null default 0 check (advance_paise >= 0),
  deduction_paise bigint not null default 0 check (deduction_paise >= 0),
  addition_paise bigint not null default 0 check (addition_paise >= 0),
  paid_paise bigint not null default 0 check (paid_paise >= 0),
  note text not null default '',
  unique (worker_id, month)
);

create trigger labour_months_audit after insert or update or delete on labour_months
  for each row execute function log_master_change('id');

alter table labour_months enable row level security;
create policy labour_months_all on labour_months for all to authenticated
  using (app_labour_access()) with check (app_labour_access());
grant select, insert, update, delete on labour_months to authenticated;
