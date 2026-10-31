-- Attendance instead of hours (owner decision 2026-10-31): each worker or staff member is marked P (present) or
-- A (absent) for the day, with overtime hours on top. Present pays a full day: 8 × the hourly rate in Setup for a
-- worker, the day rate for staff. Each OT hour pays a day's pay ÷ 8. The day's pay is kept on the row, so a later
-- change of rate leaves past days, and the salary worked out from them, as they were.
-- The table made this morning only ever held test lines, so it is made again.

drop table labour_day;

create table labour_day (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  work_date date not null,
  party_id uuid not null references parties (id),
  present boolean not null,
  ot_hours numeric(4, 2) not null default 0 check (ot_hours >= 0 and ot_hours <= 16),
  day_pay_paise bigint not null check (day_pay_paise >= 0),
  amount_paise bigint not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  -- Overtime only on a day the person came.
  check (present or ot_hours = 0),
  check (amount_paise = case when present then day_pay_paise else 0 end + round(ot_hours * day_pay_paise / 8)),
  unique (site_id, work_date, party_id)
);

-- Present at one site a day at most: otherwise the salary would pay the day twice.
create unique index labour_day_present_once on labour_day (party_id, work_date) where present;
create index labour_day_site_date on labour_day (site_id, work_date);

create trigger labour_day_worker_kind before insert or update on labour_day
  for each row execute function labour_day_must_be_worker();
create trigger labour_day_audit after insert or update or delete on labour_day
  for each row execute function log_master_change('id');

alter table labour_day enable row level security;
create policy labour_day_read on labour_day for select to authenticated using (app_has_site(site_id));
create policy labour_day_add on labour_day for insert to authenticated
  with check (app_has_site(site_id) and created_by = auth.uid());
create policy labour_day_remove on labour_day for delete to authenticated
  using (
    app_my_role() in ('owner', 'office')
    or (created_by = auth.uid()
        and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)
  );
grant select, insert, delete on labour_day to authenticated;
