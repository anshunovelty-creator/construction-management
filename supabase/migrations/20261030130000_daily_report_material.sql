-- Daily site report, part 1: material used (owner decisions 2026-10-30).
-- A supervisor reports, for a site and a day, how much of each material was used; it comes out of that site's stock.
-- Stock is kept per site, whichever firm bought it. Using more than the stock shows is allowed (shown in red).

-- Units the materials are counted in, kept in Setup. Each material names one, so a quantity always says what it is.
create table units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create trigger units_audit after insert or update or delete on units
  for each row execute function log_master_change('id');

alter table units enable row level security;
create policy units_read on units for select to authenticated using (app_my_role() is not null);
create policy units_write on units for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));
grant select, insert, update on units to authenticated;

insert into units (name) values ('Bags'), ('Box'), ('CFT'), ('Kg'), ('Ltr'), ('M2'), ('M3'), ('Nos'), ('RFT'), ('SFT'), ('Tons');

-- The free-text unit from the stock page becomes a pick from the list; anything already typed is kept.
alter table materials add column unit_id uuid references units (id);
insert into units (name)
select distinct btrim(unit) from materials where btrim(unit) <> '' on conflict (name) do nothing;
update materials m set unit_id = u.id from units u where u.name = btrim(m.unit);
alter table materials drop column unit;

-- Material used at a site on a day: one row per material line of the daily report.
create table material_use (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  use_date date not null,
  material_id uuid not null references materials (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  remark text not null default '',
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create index material_use_site_date on material_use (site_id, use_date);

-- Every line added or removed is in the change log.
create trigger material_use_audit after insert or update or delete on material_use
  for each row execute function log_master_change('id');

-- Supervisors report for their own sites; the owner and office for any. A wrong line is removed by the
-- office, or by the supervisor who added it on the same day (India time); lines are never edited.
alter table material_use enable row level security;
create policy material_use_read on material_use for select to authenticated using (app_has_site(site_id));
create policy material_use_add on material_use for insert to authenticated
  with check (app_has_site(site_id) and created_by = auth.uid());
create policy material_use_remove on material_use for delete to authenticated
  using (
    app_my_role() in ('owner', 'office')
    or (created_by = auth.uid()
        and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)
  );
grant select, insert, delete on material_use to authenticated;
