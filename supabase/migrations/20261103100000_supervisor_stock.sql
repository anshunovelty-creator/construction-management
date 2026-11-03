-- Bills are money only (owner decision 2026-11-03): the owner types what a bill comes to, not what was on it.
-- Stock is kept by the supervisors: what arrives at a site is typed by its supervisor, and comes out on the daily
-- report as before. A material's kind (Setup → Materials) says where it goes: consumables to the site's stock,
-- assets to the company's assets list. Items on bills typed before this stay with those bills, but no longer count.

create table stock_in (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  in_date date not null,
  material_id uuid not null references materials (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  -- Per unit, before GST. Left empty when the supervisor does not know it; then it is not valued.
  rate_paise bigint check (rate_paise > 0),
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create index stock_in_site_date on stock_in (site_id, in_date);

create trigger stock_in_audit after insert or update or delete on stock_in
  for each row execute function log_master_change('id');

-- Like material used: supervisors for their own sites, the owner and office for any. A wrong line is removed by the
-- office, or by the supervisor who added it on the same day (India time); lines are never edited.
alter table stock_in enable row level security;
create policy stock_in_read on stock_in for select to authenticated using (app_has_site(site_id));
create policy stock_in_add on stock_in for insert to authenticated
  with check (app_has_site(site_id) and created_by = auth.uid());
create policy stock_in_remove on stock_in for delete to authenticated
  using (
    app_my_role() in ('owner', 'office')
    or (created_by = auth.uid()
        and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)
  );
grant select, insert, delete on stock_in to authenticated;

-- Stock and assets now come from what arrived, not from bills. Supervisors read stock_in for their sites directly.
drop function app_site_bought(uuid, date);
drop view stock_in_rows;
drop view asset_in_rows;

create view stock_in_rows with (security_invoker = true) as
select i.id, i.site_id, i.in_date as entry_date, i.material_id, i.quantity, i.rate_paise,
  round(i.quantity * i.rate_paise)::bigint as amount_paise, i.note, i.created_by
from stock_in i join materials m on m.id = i.material_id
where m.item_kind = 'consumable';

create view asset_in_rows with (security_invoker = true) as
select i.id, i.site_id, i.in_date as entry_date, i.material_id, i.quantity, i.rate_paise,
  round(i.quantity * i.rate_paise)::bigint as amount_paise, i.note, i.created_by
from stock_in i join materials m on m.id = i.material_id
where m.item_kind = 'asset';

grant select on stock_in_rows, asset_in_rows to authenticated;

-- Supervisors move assets away from their own sites too, and take back a move they typed wrong.
drop policy asset_moves_add on asset_moves;
drop policy asset_moves_remove on asset_moves;
create policy asset_moves_add on asset_moves for insert to authenticated
  with check (app_has_site(from_site_id) and created_by = auth.uid());
create policy asset_moves_remove on asset_moves for delete to authenticated
  using (app_my_role() in ('owner', 'office') or created_by = auth.uid());

-- Supervisors keep their own lists in Setup: workers and staff, materials, units.
create policy parties_supervisor_add on parties for insert to authenticated
  with check (app_my_role() = 'supervisor' and kind in ('worker', 'staff'));
create policy parties_supervisor_edit on parties for update to authenticated
  using (app_my_role() = 'supervisor' and kind in ('worker', 'staff'))
  with check (app_my_role() = 'supervisor' and kind in ('worker', 'staff'));
create policy materials_edit_supervisor on materials for update to authenticated
  using (app_my_role() = 'supervisor') with check (app_my_role() = 'supervisor');
create policy units_add_supervisor on units for insert to authenticated with check (app_my_role() = 'supervisor');
create policy units_edit_supervisor on units for update to authenticated
  using (app_my_role() = 'supervisor') with check (app_my_role() = 'supervisor');
