-- Spec rule 11: every change to master data and users is logged with old value, new value, who and when.

create table master_changes (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_key text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_row jsonb,
  new_row jsonb,
  -- null = a script running with the service key (e.g. the opening-balance import)
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index master_changes_row on master_changes (table_name, row_key);

create trigger master_changes_append_only before update or delete on master_changes
  for each row execute function reject_change();
create trigger master_changes_no_truncate before truncate on master_changes
  for each statement execute function reject_change();

-- tg_argv[0] names the column that identifies the row.
create function log_master_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  insert into master_changes (table_name, row_key, action, old_row, new_row, changed_by)
  values (tg_table_name, coalesce(v_new, v_old) ->> tg_argv[0], lower(tg_op), v_old, v_new, auth.uid());
  return coalesce(new, old);
end $$;

create trigger firms_audit after insert or update or delete on firms
  for each row execute function log_master_change('id');
create trigger sites_audit after insert or update or delete on sites
  for each row execute function log_master_change('id');
create trigger parties_audit after insert or update or delete on parties
  for each row execute function log_master_change('id');
create trigger work_orders_audit after insert or update or delete on work_orders
  for each row execute function log_master_change('id');
create trigger money_accounts_audit after insert or update or delete on money_accounts
  for each row execute function log_master_change('id');
create trigger profiles_audit after insert or update or delete on profiles
  for each row execute function log_master_change('user_id');
create trigger user_firms_audit after insert or update or delete on user_firms
  for each row execute function log_master_change('user_id');
create trigger user_sites_audit after insert or update or delete on user_sites
  for each row execute function log_master_change('user_id');
