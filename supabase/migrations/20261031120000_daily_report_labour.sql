-- Daily site report, part 3: labour, staff and other costs (owner decisions 2026-10-31).
-- Workers and staff are parties kept once in Setup with their rate and usual site. Each day the supervisor marks
-- hours for a worker (rate per hour) or days for staff (rate per day). For now this is the day's cost on the
-- report only; wages owed and the weekly pay sheet will be built on these same rows.

alter table parties add column rate_paise bigint check (rate_paise is null or rate_paise >= 0);
alter table parties add column site_id uuid references sites (id);

-- Who worked at a site on a day. The rate is kept on the row, so a later change of rate leaves past days as they were.
create table labour_day (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  work_date date not null,
  party_id uuid not null references parties (id),
  -- Hours for a worker, days for staff.
  quantity numeric(5, 2) not null check (quantity > 0 and quantity <= 24),
  rate_paise bigint not null check (rate_paise >= 0),
  amount_paise bigint not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  check (amount_paise = round(quantity * rate_paise)),
  -- Marked once per site and day: a second mark would count the person twice.
  unique (site_id, work_date, party_id)
);

create function labour_day_must_be_worker() returns trigger
language plpgsql as $$
begin
  if (select kind from parties where id = new.party_id) not in ('worker', 'staff') then
    raise exception 'party % is not a worker or staff', new.party_id;
  end if;
  return new;
end $$;

create trigger labour_day_worker_kind before insert or update on labour_day
  for each row execute function labour_day_must_be_worker();

-- Anything else the site cost that day: tractor (machine hire), labour colony, room, light and petrol.
create table other_cost (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  work_date date not null,
  description text not null check (btrim(description) <> ''),
  cost_head cost_head not null check (cost_head <> 'material'),
  quantity numeric(14, 3) not null check (quantity > 0),
  rate_paise bigint not null check (rate_paise >= 0),
  amount_paise bigint not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  check (amount_paise = round(quantity * rate_paise))
);

create index labour_day_site_date on labour_day (site_id, work_date);
create index other_cost_site_date on other_cost (site_id, work_date);

create trigger labour_day_audit after insert or update or delete on labour_day
  for each row execute function log_master_change('id');
create trigger other_cost_audit after insert or update or delete on other_cost
  for each row execute function log_master_change('id');

-- The same rules as the rest of the report: supervisors for their own sites; wrong lines removed, never edited.
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

alter table other_cost enable row level security;
create policy other_cost_read on other_cost for select to authenticated using (app_has_site(site_id));
create policy other_cost_add on other_cost for insert to authenticated
  with check (app_has_site(site_id) and created_by = auth.uid());
create policy other_cost_remove on other_cost for delete to authenticated
  using (
    app_my_role() in ('owner', 'office')
    or (created_by = auth.uid()
        and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)
  );
grant select, insert, delete on other_cost to authenticated;
