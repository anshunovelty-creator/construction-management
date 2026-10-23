-- Who can read and write what through the Supabase API. Keep this migration last:
-- it revokes everything first, then grants back only what the app needs.

-- Fail closed: tables and functions created later are unreachable from the API until granted on purpose.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- The secret key (scripts, creating logins) acts as service_role. Granted explicitly rather than
-- relying on project defaults, which have changed between Supabase versions.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter table firms enable row level security;
alter table sites enable row level security;
alter table parties enable row level security;
alter table work_orders enable row level security;
alter table money_accounts enable row level security;
alter table profiles enable row level security;
alter table user_firms enable row level security;
alter table user_sites enable row level security;
alter table entries enable row level security;
alter table entry_lines enable row level security;
alter table entry_events enable row level security;
alter table books_locks enable row level security;
alter table serial_counters enable row level security;
alter table master_changes enable row level security;

-- Masters. The owner manages them; office staff may also add and edit parties (vendors).
create policy firms_read on firms for select to authenticated using (app_my_role() is not null);
create policy firms_owner on firms for all to authenticated using (app_is_owner()) with check (app_is_owner());

create policy sites_read on sites for select to authenticated using (app_has_site(id));
create policy sites_owner on sites for all to authenticated using (app_is_owner()) with check (app_is_owner());

create policy parties_read on parties for select to authenticated using (app_my_role() is not null);
create policy parties_write on parties for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));

-- Work orders hold client rates and terms: never visible to supervisors.
create policy work_orders_read on work_orders for select to authenticated using (app_has_firm(firm_id));
create policy work_orders_owner on work_orders for all to authenticated
  using (app_is_owner()) with check (app_is_owner());

create policy money_accounts_read on money_accounts for select to authenticated using (
  app_is_owner()
  or (app_my_role() = 'office' and (firm_id is null or app_has_firm(firm_id)))
  or (app_my_role() is not null and holder_user_id = auth.uid())
);
create policy money_accounts_owner on money_accounts for all to authenticated
  using (app_is_owner()) with check (app_is_owner());

create policy profiles_read on profiles for select to authenticated using (app_my_role() is not null);
create policy profiles_owner on profiles for all to authenticated using (app_is_owner()) with check (app_is_owner());

create policy user_firms_read on user_firms for select to authenticated
  using (user_id = auth.uid() or app_is_owner());
create policy user_firms_owner on user_firms for all to authenticated
  using (app_is_owner()) with check (app_is_owner());

create policy user_sites_read on user_sites for select to authenticated
  using (user_id = auth.uid() or app_is_owner());
create policy user_sites_owner on user_sites for all to authenticated
  using (app_is_owner()) with check (app_is_owner());

-- Ledger: read-only through the API. Writes go only through the app_* functions.
-- ponytail: per-row function calls; rewrite as join-based policies if the day book gets slow.
create policy entries_read on entries for select to authenticated using (app_can_see_entry(id));
create policy entry_lines_read on entry_lines for select to authenticated using (app_can_see_entry(entry_id));
create policy entry_events_read on entry_events for select to authenticated using (app_can_see_entry(entry_id));
create policy books_locks_read on books_locks for select to authenticated using (app_my_role() is not null);
create policy master_changes_read on master_changes for select to authenticated using (app_is_owner());

-- Views run with their owner's rights unless told otherwise, which would skip the policies above.
alter view entry_status set (security_invoker = true);

grant select on firms, sites, parties, work_orders, money_accounts, profiles, user_firms, user_sites,
  entries, entry_lines, entry_events, books_locks, master_changes, entry_status to authenticated;
grant insert, update on firms, sites, parties, work_orders, money_accounts, profiles to authenticated;
grant insert, delete on user_firms, user_sites to authenticated;

grant execute on function
  app_my_role(), app_is_owner(), app_has_firm(uuid), app_has_site(uuid), app_can_see_entry(uuid),
  app_set_my_language(app_language), app_post_entry(jsonb, text), app_verify_entry(uuid),
  app_reject_entry(uuid, text), app_reverse_entry(uuid, text), app_replace_entry(uuid, jsonb, text),
  app_lock_books(date, text)
to authenticated;
