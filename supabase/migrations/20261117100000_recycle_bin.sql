-- Recycle bin (owner decision 2026-11-17). A deleted Setup record, labour-supply worker, AJAX machine or combination
-- work is kept here for 30 days and can be put back. Deleting runs inside these functions as the person signed in, so
-- the change log (master_changes, whose trigger records auth.uid()) says who deleted it.
-- Firms are never deleted (owner decision): they are not in the list below. Ledger rows are never deleted either.

create table recycle_bin (
  id uuid primary key default gen_random_uuid(),
  -- Where it came from: a Setup list (sites, parties, workers, ...), or labour-workers, machines, mixes.
  kind text not null,
  record_id uuid not null,
  name text not null,
  -- [{table, row}], the record first and then its own lines, in the order they are put back.
  rows jsonb not null,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);

alter table recycle_bin enable row level security;
create policy recycle_bin_read on recycle_bin for select to authenticated using (app_is_owner());
grant select on recycle_bin to authenticated;

-- What each kind deletes: its table, and the table of its own lines (deleted and kept with it) linked by which column.
create function app_bin_kind(p_kind text, out tbl text, out child text, out link text)
language sql immutable as $$
  select t, c, l from (values
    ('sites', 'sites', null, null), ('parties', 'parties', null, null), ('workers', 'parties', null, null),
    ('money-accounts', 'money_accounts', null, null), ('materials', 'materials', null, null), ('units', 'units', null, null),
    ('gst-rates', 'gst_rates', null, null), ('tds-rates', 'tds_rates', null, null),
    ('labour-workers', 'labour_workers', 'labour_rates', 'worker_id'),
    ('machines', 'machines', 'machine_services', 'machine_id'),
    ('mixes', 'mixes', 'mix_items', 'mix_id')
  ) k (kind, t, c, l) where kind = p_kind
$$;

-- Moves a record (with its own lines) into the bin. Only the owner, except that the office and the labour login may
-- delete a labour-supply worker, and only one with no month saved. Anything still used elsewhere is refused by the
-- database's own links (foreign key error 23503, naming the table that uses it), and nothing is changed.
create function app_bin_delete(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  k record;
  v_role app_role := app_my_role();
  v_row jsonb;
  v_lines jsonb := '[]';
begin
  select * into k from app_bin_kind(p_kind);
  if k.tbl is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not (v_role = 'owner' or (p_kind = 'labour-workers' and v_role in ('office', 'labour'))) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_kind = 'labour-workers' and exists (select 1 from labour_months where worker_id = p_id) then
    raise exception 'has_months';
  end if;
  execute format('select to_jsonb(x) from %I x where id = $1', k.tbl) into v_row using p_id;
  if v_row is null then
    raise exception 'not_found';
  end if;
  if k.child is not null then
    execute format('select coalesce(jsonb_agg(jsonb_build_object(''table'', %L, ''row'', to_jsonb(x))), ''[]'') from %I x where %I = $1',
      k.child, k.child, k.link) into v_lines using p_id;
    execute format('delete from %I where %I = $1', k.child, k.link) using p_id;
  end if;
  execute format('delete from %I where id = $1', k.tbl) using p_id;
  insert into recycle_bin (kind, record_id, name, rows, deleted_by)
  values (p_kind, p_id,
    coalesce(v_row ->> 'name', concat_ws(' ', v_row ->> 'section', ((v_row ->> 'rate_bp')::numeric / 100)::text || '%')),
    jsonb_build_array(jsonb_build_object('table', k.tbl, 'row', v_row)) || v_lines,
    auth.uid());
  -- Kept for 30 days.
  delete from recycle_bin where deleted_at < now() - interval '30 days';
end $$;

-- Puts a record back exactly as it was, with the same id, so nothing that pointed to it before is lost. A record of the
-- same name added since is refused (unique error 23505), as is one whose unit or site has been deleted since (23503).
create function app_bin_restore(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item recycle_bin;
  v_part jsonb;
begin
  if not app_is_owner() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_item from recycle_bin where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
  for v_part in select value from jsonb_array_elements(v_item.rows) loop
    execute format('insert into %I select * from jsonb_populate_record(null::%I, $1)', v_part ->> 'table', v_part ->> 'table')
      using v_part -> 'row';
  end loop;
  delete from recycle_bin where id = p_id;
end $$;

-- Empties one item from the bin for good. Owner only.
create function app_bin_purge(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_owner() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from recycle_bin where id = p_id;
end $$;

revoke execute on function app_bin_delete(text, uuid), app_bin_restore(uuid), app_bin_purge(uuid) from public, anon;
grant execute on function app_bin_delete(text, uuid), app_bin_restore(uuid), app_bin_purge(uuid) to authenticated;
