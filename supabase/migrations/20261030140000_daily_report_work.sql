-- Daily site report, part 2: work done (owner decisions 2026-10-30). The supervisor types each line like the
-- Excel sheet: the activity, its measurement ("4.3*0.45*2"), the unit and the rate. The app works out the quantity
-- from the measurement and the amount from quantity × rate. Supervisors see rates and amounts on their report.

create table work_done (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  work_date date not null,
  activity text not null check (btrim(activity) <> ''),
  measurement text not null check (btrim(measurement) <> ''),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_id uuid not null references units (id),
  -- Zero is allowed: work done that is not billed on its own, like deshuttering.
  rate_paise bigint not null check (rate_paise >= 0),
  amount_paise bigint not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  check (amount_paise = round(quantity * rate_paise))
);

create index work_done_site_date on work_done (site_id, work_date);

create trigger work_done_audit after insert or update or delete on work_done
  for each row execute function log_master_change('id');

-- The same rules as material used: supervisors for their own sites; wrong lines removed, never edited.
alter table work_done enable row level security;
create policy work_done_read on work_done for select to authenticated using (app_has_site(site_id));
create policy work_done_add on work_done for insert to authenticated
  with check (app_has_site(site_id) and created_by = auth.uid());
create policy work_done_remove on work_done for delete to authenticated
  using (
    app_my_role() in ('owner', 'office')
    or (created_by = auth.uid()
        and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)
  );
grant select, insert, delete on work_done to authenticated;

-- What was bought for a site up to a day, per material: for the material rates on the daily report.
-- Supervisors may not read the party bills themselves, so this answers only for sites they work on.
create function app_site_bought(p_site_id uuid, p_upto date)
returns table (material_id uuid, quantity numeric, amount_paise bigint)
language sql stable security definer set search_path = public as $$
  select r.material_id, sum(r.quantity), sum(r.amount_paise)::bigint
  from stock_in_rows r
  where r.site_id = p_site_id and r.entry_date <= p_upto and app_has_site(p_site_id)
  group by r.material_id
$$;

revoke execute on function app_site_bought(uuid, date) from public;
grant execute on function app_site_bought(uuid, date) to authenticated;
