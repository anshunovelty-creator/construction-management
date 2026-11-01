-- Go-live reset (owner decision 2026-11-01): clears every test transaction and the test setup records, so the live
-- books start empty. Paste ALL of it into Supabase -> SQL Editor and Run, once.
-- It is a single statement, so it is all or nothing: if anything fails (a misspelt name, say), nothing changes.
--
-- 1. Copies every table it touches into schema golive_backup_20261101 (not reachable from the app or the API).
-- 2. Deletes all entries (opening balances included) with their lines, items, TDS, history and period locks, and
--    restarts entry numbering at 000001.
-- 3. Deletes the daily reports (material used, work done, labour/attendance, other costs).
-- 4. Deletes the test setup records: everything whose name starts with DEMO, the demo.…@example.com logins, and the
--    names you list below.
-- Kept: every other firm, site, party, material, unit, bank/cash account, GST/TDS rate and user; the Setup change log.
-- When the live books look right, drop the backup:  drop schema golive_backup_20261101 cascade;

do $$
declare
  -- ---- Test records to remove besides the DEMO ones. Put exact names in quotes between the [ ], separated by
  -- commas, for example:   remove_parties text[] := array['Test Vendor', 'ABC Test']::text[];
  -- Accounts are money account names; users are login emails.
  remove_parties text[] := array[]::text[];
  remove_sites text[] := array[]::text[];
  remove_firms text[] := array[]::text[];
  remove_materials text[] := array[]::text[];
  remove_accounts text[] := array[]::text[];
  remove_users text[] := array[]::text[];
  -- -----------------------------------------------------------------------------------------------------------------
  v_missing text;
  gone_firms uuid[]; gone_sites uuid[]; gone_parties uuid[]; gone_materials uuid[]; gone_units uuid[];
  gone_users uuid[]; gone_accounts uuid[]; gone_work_orders uuid[];
begin
  -- A typo must not silently keep a test record: every listed name has to exist.
  select string_agg(missing, ', ') into v_missing from (
    select 'party "' || n || '"' as missing from unnest(remove_parties) n where not exists (select 1 from parties where name = n)
    union all select 'site "' || n || '"' from unnest(remove_sites) n where not exists (select 1 from sites where name = n)
    union all select 'firm "' || n || '"' from unnest(remove_firms) n where not exists (select 1 from firms where name = n)
    union all select 'material "' || n || '"' from unnest(remove_materials) n where not exists (select 1 from materials where name = n)
    union all select 'account "' || n || '"' from unnest(remove_accounts) n where not exists (select 1 from money_accounts where name = n)
    union all select 'user "' || n || '"' from unnest(remove_users) n where not exists (select 1 from profiles where email = n)
  ) m;
  if v_missing is not null then
    raise exception 'not found (check the spelling): %', v_missing;
  end if;

  -- What goes: DEMO-named records plus the lists. Firms, sites and parties take their dependants with them.
  gone_firms := array(select id from firms where name ilike 'DEMO%' or name = any(remove_firms));
  gone_sites := array(select id from sites where name ilike 'DEMO%' or name = any(remove_sites));
  gone_parties := array(select id from parties where name ilike 'DEMO%' or name = any(remove_parties));
  gone_materials := array(select id from materials where name ilike 'DEMO%' or name = any(remove_materials));
  gone_units := array(select id from units where name ilike 'DEMO%');
  gone_users := array(select user_id from profiles
    where full_name ilike 'DEMO%' or email ilike 'demo.%@example.com' or email = any(remove_users));
  gone_accounts := array(select id from money_accounts
    where name ilike 'DEMO%' or name = any(remove_accounts) or firm_id = any(gone_firms) or holder_user_id = any(gone_users));
  gone_work_orders := array(select id from work_orders
    where firm_id = any(gone_firms) or site_id = any(gone_sites) or client_id = any(gone_parties));

  -- ---- 1. Backup ----------------------------------------------------------------------------------------------------
  create schema golive_backup_20261101;
  create table golive_backup_20261101.entries as table entries;
  create table golive_backup_20261101.entry_lines as table entry_lines;
  create table golive_backup_20261101.entry_events as table entry_events;
  create table golive_backup_20261101.bill_items as table bill_items;
  create table golive_backup_20261101.bill_tds as table bill_tds;
  create table golive_backup_20261101.books_locks as table books_locks;
  create table golive_backup_20261101.serial_counters as table serial_counters;
  create table golive_backup_20261101.material_use as table material_use;
  create table golive_backup_20261101.work_done as table work_done;
  create table golive_backup_20261101.labour_day as table labour_day;
  create table golive_backup_20261101.other_cost as table other_cost;
  create table golive_backup_20261101.firms as table firms;
  create table golive_backup_20261101.sites as table sites;
  create table golive_backup_20261101.parties as table parties;
  create table golive_backup_20261101.materials as table materials;
  create table golive_backup_20261101.units as table units;
  create table golive_backup_20261101.money_accounts as table money_accounts;
  create table golive_backup_20261101.work_orders as table work_orders;
  create table golive_backup_20261101.profiles as table profiles;
  create table golive_backup_20261101.user_firms as table user_firms;
  create table golive_backup_20261101.user_sites as table user_sites;
  create table golive_backup_20261101.working_firms as table working_firms;
  create table golive_backup_20261101.auth_users as select * from auth.users where id = any(gone_users);
  revoke all on schema golive_backup_20261101 from public;

  -- ---- 2. Transactions ----------------------------------------------------------------------------------------------
  -- The books are append-only; the guard is lifted for these deletes only and put back straight after.
  alter table entries disable trigger entries_append_only;
  alter table entry_lines disable trigger entry_lines_append_only;
  alter table entry_events disable trigger entry_events_append_only;
  alter table bill_items disable trigger bill_items_append_only;
  alter table bill_tds disable trigger bill_tds_append_only;
  alter table books_locks disable trigger books_locks_append_only;
  delete from entry_events;
  delete from bill_tds;
  delete from bill_items;
  delete from entry_lines;
  delete from entries;
  delete from books_locks;
  delete from serial_counters;
  alter table entries enable trigger entries_append_only;
  alter table entry_lines enable trigger entry_lines_append_only;
  alter table entry_events enable trigger entry_events_append_only;
  alter table bill_items enable trigger bill_items_append_only;
  alter table bill_tds enable trigger bill_tds_append_only;
  alter table books_locks enable trigger books_locks_append_only;

  -- ---- 3. Daily reports and attendance ------------------------------------------------------------------------------
  delete from material_use;
  delete from work_done;
  delete from labour_day;
  delete from other_cost;

  -- ---- 4. Test setup records ----------------------------------------------------------------------------------------
  delete from working_firms where user_id = any(gone_users) or firm_id = any(gone_firms);
  delete from user_firms where user_id = any(gone_users) or firm_id = any(gone_firms);
  delete from user_sites where user_id = any(gone_users) or site_id = any(gone_sites);
  delete from work_orders where id = any(gone_work_orders);
  delete from money_accounts where id = any(gone_accounts);
  delete from parties where id = any(gone_parties);
  delete from sites where id = any(gone_sites);
  delete from materials where id = any(gone_materials);
  delete from units where id = any(gone_units);
  delete from firms where id = any(gone_firms);
  delete from profiles where user_id = any(gone_users);
  delete from auth.users where id = any(gone_users);
end $$;

-- What is left:
select 'entries' as what, count(*) from entries
union all select 'firms', count(*) from firms
union all select 'sites', count(*) from sites
union all select 'parties', count(*) from parties
union all select 'materials', count(*) from materials
union all select 'money accounts', count(*) from money_accounts
union all select 'users', count(*) from profiles;
