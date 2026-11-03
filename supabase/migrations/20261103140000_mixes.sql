-- Combination works (owner decision 2026-11-03): PCC, RCC, plaster, tiles... each made of several materials in a set
-- ratio, kept by the supervisors in Setup. `quantity` is how much of the material 1 unit of the work takes. On the
-- daily report, picking a work adds its materials to the material used list; the supervisor types what was used.
create table mixes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  unit_id uuid references units (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table mix_items (
  id uuid primary key default gen_random_uuid(),
  mix_id uuid not null references mixes (id) on delete cascade,
  material_id uuid not null references materials (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  position integer not null default 0,
  unique (mix_id, material_id)
);

create trigger mixes_audit after insert or update or delete on mixes
  for each row execute function log_master_change('id');
create trigger mix_items_audit after insert or update or delete on mix_items
  for each row execute function log_master_change('id');

-- Everyone signed in keeps this list: the owner, the office and the supervisors. A work's materials are saved again
-- whole when it is changed, so its lines may be removed.
alter table mixes enable row level security;
create policy mixes_read on mixes for select to authenticated using (app_my_role() is not null);
create policy mixes_write on mixes for all to authenticated
  using (app_my_role() is not null) with check (app_my_role() is not null);
grant select, insert, update on mixes to authenticated;

alter table mix_items enable row level security;
create policy mix_items_read on mix_items for select to authenticated using (app_my_role() is not null);
create policy mix_items_write on mix_items for all to authenticated
  using (app_my_role() is not null) with check (app_my_role() is not null);
grant select, insert, update, delete on mix_items to authenticated;

-- The rate the supervisor gave a used line (paise per unit). Empty: the average rate of what arrived at that site.
alter table material_use add column rate_paise bigint check (rate_paise >= 0);
