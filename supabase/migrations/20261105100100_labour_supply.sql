-- The labour supply business: its own workers, attendance, deduction rates and money, apart from the firms' ledger.
-- See docs/superpowers/specs/2026-11-05-labour-supply-design.md.

create function app_labour_access() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_my_role() in ('owner', 'office', 'labour'), false)
$$;

create table labour_workers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  kind text not null check (kind in ('worker', 'staff')),
  phone text not null default '',
  skill text not null default '',
  joined_on date not null,
  left_on date,
  pf_on boolean not null default true,
  esic_on boolean not null default true,
  uan text not null default '',
  esic_number text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (left_on is null or left_on >= joined_on)
);

-- Worker: per 8-hour day. Staff: per month. Each rate counts from the first of its month.
create table labour_rates (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references labour_workers (id),
  from_month date not null check (extract(day from from_month) = 1),
  rate_paise bigint not null check (rate_paise >= 0),
  unique (worker_id, from_month)
);

create table labour_settings (
  id uuid primary key default gen_random_uuid(),
  from_month date not null unique check (extract(day from from_month) = 1),
  pf_bp integer not null check (pf_bp between 0 and 10000),
  pf_ceiling_paise bigint not null check (pf_ceiling_paise >= 0),
  esic_bp integer not null check (esic_bp between 0 and 10000),
  esic_limit_paise bigint not null check (esic_limit_paise >= 0),
  -- 100 pays an OT hour at the normal hour's rate, 200 at double.
  ot_percent integer not null default 100 check (ot_percent between 0 and 500)
);
insert into labour_settings (from_month, pf_bp, pf_ceiling_paise, esic_bp, esic_limit_paise, ot_percent)
  values ('2000-01-01', 1200, 1500000, 75, 2100000, 100);

create table labour_attendance (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references labour_workers (id),
  work_date date not null,
  present boolean not null,
  ot_hours numeric(4, 2) not null default 0 check (ot_hours >= 0 and ot_hours <= 16),
  check (present or ot_hours = 0),
  unique (worker_id, work_date)
);

create function labour_attendance_staff_no_ot() returns trigger
language plpgsql as $$
begin
  if new.ot_hours <> 0 and (select kind from labour_workers where id = new.worker_id) = 'staff' then
    raise exception 'staff get a fixed salary, no OT';
  end if;
  return new;
end $$;
create trigger labour_attendance_staff_no_ot before insert or update on labour_attendance
  for each row execute function labour_attendance_staff_no_ot();

-- Money lines are never changed: a wrong one is removed, and the change log keeps it.
create table labour_money (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references labour_workers (id),
  money_date date not null,
  kind text not null check (kind in ('advance', 'payment', 'deduction')),
  amount_paise bigint not null check (amount_paise > 0),
  method text check (method in ('cash', 'bank')),
  reference text not null default '',
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  check ((kind = 'deduction') = (method is null)),
  check (kind <> 'deduction' or btrim(note) <> '')
);
create index labour_money_worker on labour_money (worker_id, money_date);

-- One line per person and month, so the lists need not read every day of every card.
create view labour_month_days with (security_invoker = true) as
  select worker_id, to_char(work_date, 'YYYY-MM') as month,
    count(*) filter (where present)::int as present,
    count(*) filter (where not present)::int as absent,
    coalesce(sum(ot_hours), 0) as ot_hours
  from labour_attendance group by worker_id, to_char(work_date, 'YYYY-MM');
grant select on labour_month_days to authenticated;

create trigger labour_workers_audit after insert or update or delete on labour_workers
  for each row execute function log_master_change('id');
create trigger labour_rates_audit after insert or update or delete on labour_rates
  for each row execute function log_master_change('id');
create trigger labour_settings_audit after insert or update or delete on labour_settings
  for each row execute function log_master_change('id');
create trigger labour_attendance_audit after insert or update or delete on labour_attendance
  for each row execute function log_master_change('id');
create trigger labour_money_audit after insert or update or delete on labour_money
  for each row execute function log_master_change('id');

alter table labour_workers enable row level security;
create policy labour_workers_all on labour_workers for all to authenticated
  using (app_labour_access()) with check (app_labour_access());
grant select, insert, update on labour_workers to authenticated;

alter table labour_rates enable row level security;
create policy labour_rates_all on labour_rates for all to authenticated
  using (app_labour_access()) with check (app_labour_access());
grant select, insert, update on labour_rates to authenticated;

alter table labour_settings enable row level security;
create policy labour_settings_read on labour_settings for select to authenticated using (app_labour_access());
create policy labour_settings_write on labour_settings for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));
grant select, insert, update on labour_settings to authenticated;

alter table labour_attendance enable row level security;
create policy labour_attendance_all on labour_attendance for all to authenticated
  using (app_labour_access()) with check (app_labour_access());
grant select, insert, update, delete on labour_attendance to authenticated;

alter table labour_money enable row level security;
create policy labour_money_read on labour_money for select to authenticated using (app_labour_access());
create policy labour_money_add on labour_money for insert to authenticated
  with check (app_labour_access() and created_by = auth.uid());
create policy labour_money_remove on labour_money for delete to authenticated
  using (
    app_my_role() in ('owner', 'office')
    or (app_labour_access() and created_by = auth.uid()
        and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)
  );
grant select, insert, delete on labour_money to authenticated;

-- A Labour login sees nothing of the firms. These tables were open to anyone signed in.
alter policy parties_read on parties using (app_my_role() <> 'labour');
alter policy firms_read on firms using (app_my_role() <> 'labour');
alter policy materials_read on materials using (app_my_role() <> 'labour');
alter policy mixes_read on mixes using (app_my_role() <> 'labour');
alter policy mix_items_read on mix_items using (app_my_role() <> 'labour');
alter policy units_read on units using (app_my_role() <> 'labour');
alter policy gst_rates_read on gst_rates using (app_my_role() <> 'labour');
alter policy tds_rates_read on tds_rates using (app_my_role() <> 'labour');
alter policy asset_moves_read on asset_moves using (app_my_role() <> 'labour');
alter policy books_locks_read on books_locks using (app_my_role() <> 'labour');
alter policy profiles_read on profiles using (app_my_role() <> 'labour' or user_id = auth.uid());
