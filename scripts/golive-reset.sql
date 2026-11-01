-- Go-live reset (owner decision 2026-11-01): clears every test transaction and the test setup records, so the live
-- books start empty. Run ONCE, as a whole, in Supabase -> SQL Editor. It is one transaction: if anything fails,
-- nothing changes.
--
-- What it does:
--   1. Copies every table it touches into schema golive_backup_20261101 (not reachable from the app or the API).
--   2. Deletes all entries (opening balances included) with their lines, items, TDS, history and period locks, and
--      restarts entry numbering at 000001.
--   3. Deletes the daily reports (material used, work done, labour/attendance, other costs).
--   4. Deletes the test setup records: everything whose name starts with DEMO, the demo logins, and the names you
--      list below.
-- Kept: every other firm, site, party, material, unit, bank/cash account, GST/TDS rate and user; the Setup change log.
-- Undo: the backup schema holds every deleted row. Drop it when the live books look right:
--   drop schema golive_backup_20261101 cascade;

begin;

-- ---- The test setup records to remove besides the DEMO ones: exact names, one per line. ----------------------------
-- kind: 'firm' | 'site' | 'party' | 'material' | 'unit' | 'money_account' | 'work_order' (its ref) | 'user' (its email)
create temp table golive_remove (kind text not null, name text not null) on commit drop;
insert into golive_remove (kind, name) values
  ('party', '__nothing__') -- golive:list  (replace this line with your list, e.g. ('party', 'Test Vendor'), ('site', 'Site 1'))
;
delete from golive_remove where name = '__nothing__';

-- A typo must not silently keep a test record: every listed name has to exist.
do $$
declare v_missing text;
begin
  select string_agg(r.kind || ' "' || r.name || '"', ', ') into v_missing from golive_remove r
  where not case r.kind
    when 'firm' then exists (select 1 from firms where name = r.name)
    when 'site' then exists (select 1 from sites where name = r.name)
    when 'party' then exists (select 1 from parties where name = r.name)
    when 'material' then exists (select 1 from materials where name = r.name)
    when 'unit' then exists (select 1 from units where name = r.name)
    when 'money_account' then exists (select 1 from money_accounts where name = r.name)
    when 'work_order' then exists (select 1 from work_orders where ref = r.name)
    when 'user' then exists (select 1 from profiles where email = r.name)
    else false
  end;
  if v_missing is not null then
    raise exception 'not found (check the spelling): %', v_missing;
  end if;
end $$;

-- What goes: DEMO-named records plus the list. Firms, sites and parties take their dependants with them.
create temp table gone_firms on commit drop as
  select id from firms where name ilike 'DEMO%' or name in (select name from golive_remove where kind = 'firm');
create temp table gone_sites on commit drop as
  select id from sites where name ilike 'DEMO%' or name in (select name from golive_remove where kind = 'site');
create temp table gone_parties on commit drop as
  select id from parties where name ilike 'DEMO%' or name in (select name from golive_remove where kind = 'party');
create temp table gone_materials on commit drop as
  select id from materials where name ilike 'DEMO%' or name in (select name from golive_remove where kind = 'material');
create temp table gone_units on commit drop as
  select id from units where name ilike 'DEMO%' or name in (select name from golive_remove where kind = 'unit');
create temp table gone_users on commit drop as
  select user_id as id from profiles
  where full_name ilike 'DEMO%' or email ilike 'demo.%@example.com' or email in (select name from golive_remove where kind = 'user');
create temp table gone_accounts on commit drop as
  select id from money_accounts
  where name ilike 'DEMO%' or name in (select name from golive_remove where kind = 'money_account')
     or firm_id in (select id from gone_firms) or holder_user_id in (select id from gone_users);
create temp table gone_work_orders on commit drop as
  select id from work_orders
  where ref in (select name from golive_remove where kind = 'work_order')
     or firm_id in (select id from gone_firms) or site_id in (select id from gone_sites) or client_id in (select id from gone_parties);

-- ---- 1. Backup ------------------------------------------------------------------------------------------------------
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
create table golive_backup_20261101.auth_users as select * from auth.users where id in (select id from gone_users);
revoke all on schema golive_backup_20261101 from public;

-- ---- 2. Transactions ------------------------------------------------------------------------------------------------
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

-- ---- 3. Daily reports and attendance --------------------------------------------------------------------------------
delete from material_use;
delete from work_done;
delete from labour_day;
delete from other_cost;

-- ---- 4. Test setup records ------------------------------------------------------------------------------------------
delete from working_firms where user_id in (select id from gone_users) or firm_id in (select id from gone_firms);
delete from user_firms where user_id in (select id from gone_users) or firm_id in (select id from gone_firms);
delete from user_sites where user_id in (select id from gone_users) or site_id in (select id from gone_sites);
delete from work_orders where id in (select id from gone_work_orders);
delete from money_accounts where id in (select id from gone_accounts);
delete from parties where id in (select id from gone_parties);
delete from sites where id in (select id from gone_sites);
delete from materials where id in (select id from gone_materials);
delete from units where id in (select id from gone_units);
delete from firms where id in (select id from gone_firms);
delete from profiles where user_id in (select id from gone_users);
delete from auth.users where id in (select id from gone_users);

commit;

-- What is left (run on its own afterwards, or read it in the results):
select 'entries' as what, count(*) from entries
union all select 'firms', count(*) from firms
union all select 'sites', count(*) from sites
union all select 'parties', count(*) from parties
union all select 'materials', count(*) from materials
union all select 'money accounts', count(*) from money_accounts
union all select 'users', count(*) from profiles;
