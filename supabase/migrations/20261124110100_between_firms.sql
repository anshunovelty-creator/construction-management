-- 1. The firm that runs the Labour payment business and owns the AJAX machines (Ansari Enterprise).
alter table firms add column runs_labour boolean not null default false;
create unique index firms_one_runs_labour on firms (runs_labour) where runs_labour;

-- 2. Lines. GST and TDS on a supply between our firms name the other firm instead of a party; what one firm earns from
-- another is firm_income, kept apart from what clients are billed.
alter table entry_lines drop constraint line_dimensions;
alter table entry_lines add constraint line_dimensions check (
  case account
    when 'money' then
      money_account_id is not null and counter_firm_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'vendor_payable' then
      firm_id is not null and party_id is not null and counter_firm_id is null
      and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
    when 'inter_firm' then
      firm_id is not null and counter_firm_id is not null and firm_id <> counter_firm_id
      and money_account_id is null and party_id is null and site_id is null
      and work_order_id is null and cost_head is null
    when 'firm_income' then
      firm_id is not null and counter_firm_id is not null and firm_id <> counter_firm_id
      and cost_head in ('labour', 'machine_hire')
      and money_account_id is null and party_id is null and site_id is null and work_order_id is null
    when 'site_cost' then
      site_id is not null and cost_head is not null and counter_firm_id is null and money_account_id is null
    when 'owner_capital' then
      counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'opening_balance' then
      counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'cash_short_excess' then
      counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'not_yet_known' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'contract_income' then
      firm_id is not null and party_id is not null and site_id is not null
      and counter_firm_id is null and money_account_id is null and cost_head is null
    when 'tds_claimable' then
      firm_id is not null and (party_id is null) <> (counter_firm_id is null)
      and money_account_id is null and cost_head is null
    -- client_receivable, retention_held, security_deposit_held, company_assets: the site is optional
    when 'client_receivable' then
      firm_id is not null and party_id is not null and counter_firm_id is null and money_account_id is null and cost_head is null
    when 'retention_held' then
      firm_id is not null and party_id is not null and counter_firm_id is null and money_account_id is null and cost_head is null
    when 'security_deposit_held' then
      firm_id is not null and party_id is not null and counter_firm_id is null and money_account_id is null and cost_head is null
    when 'company_assets' then
      firm_id is not null and party_id is not null and counter_firm_id is null and money_account_id is null and cost_head is null
    -- gst_input, gst_output, tds_payable
    else
      firm_id is not null and (party_id is null) <> (counter_firm_id is null)
      and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
  end
);

-- 3. Money may move between firms again (owner decision 2026-11-24, replaces 20261029150000), but only as these entries.
create or replace function entry_lines_firms_independent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.account in ('inter_firm', 'firm_income') and not exists (
    select 1 from entries where id = new.entry_id
      and entry_type in ('firm_transfer', 'labour_supplied', 'machine_rent', 'vendor_payment', 'opening', 'reversal')
  ) then
    raise exception 'this kind of entry cannot move money between firms';
  end if;
  return new;
end $$;

-- At commit: both firms say the same; one opening per pair of firms with nothing before it; and one labour supplied per
-- month, firm and site, so a month confirmed twice is never counted twice.
create function entries_check_firms() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_pair record;
  v_openings integer;
  v_opened date;
begin
  if new.entry_type = 'reversal' then
    return null;
  end if;
  for v_pair in
    select least(firm_id, counter_firm_id) as a, greatest(firm_id, counter_firm_id) as b, sum(amount_paise) as net
    from entry_lines where entry_id = new.id and account = 'inter_firm'
    group by 1, 2 order by 1, 2
  loop
    if v_pair.net <> 0 then
      raise exception 'the two firms of entry % do not say the same', new.serial;
    end if;
    perform pg_advisory_xact_lock(hashtext(v_pair.a::text || v_pair.b::text));
    select count(distinct e.id), min(e.entry_date) into v_openings, v_opened
    from entry_lines l join entries e on e.id = l.entry_id join entry_status s on s.entry_id = e.id
    where l.account = 'inter_firm' and l.firm_id = v_pair.a and l.counter_firm_id = v_pair.b
      and e.entry_type = 'opening' and s.status in ('verified', 'unverified');
    if v_openings > 1 then
      raise exception 'these two firms already have an opening balance';
    end if;
    if v_opened is not null and exists (
      select 1 from entry_lines l join entries e on e.id = l.entry_id join entry_status s on s.entry_id = e.id
      where l.account = 'inter_firm' and l.firm_id = v_pair.a and l.counter_firm_id = v_pair.b
        and e.entry_date < v_opened and s.status in ('verified', 'unverified')
    ) then
      raise exception 'the opening balance between these firms is on %, and nothing can be dated before that',
        to_char(v_opened, 'FMDD Mon YYYY');
    end if;
  end loop;
  if new.entry_type = 'labour_supplied' and exists (
    select 1 from entry_lines m
    join entry_lines l on l.account = 'site_cost' and l.firm_id = m.firm_id and l.site_id = m.site_id and l.entry_id <> m.entry_id
    join entries e on e.id = l.entry_id join entry_status s on s.entry_id = e.id
    where m.entry_id = new.id and m.account = 'site_cost'
      and e.entry_type = 'labour_supplied' and e.reference = new.reference and s.status in ('verified', 'unverified')
  ) then
    raise exception 'labour supplied for this month and site is already in the books';
  end if;
  return null;
end $$;

create constraint trigger entries_firms after insert on entries
  deferrable initially deferred
  for each row execute function entries_check_firms();

-- 4. An entry in two firms' books: office staff see only their firms' lines of it (each firm's lines add up to zero on
-- their own), and may make or cancel it only with both firms.
drop policy entry_lines_read on entry_lines;
create policy entry_lines_read on entry_lines for select to authenticated using (
  app_can_see_entry(entry_id) and (app_my_role() <> 'office' or firm_id is null or app_has_firm(firm_id))
);

create or replace function app_assert_can_cancel(p_entry_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_role app_role := app_assert_signed_in();
  v_entry entries%rowtype;
  v_lock date := current_lock_date();
begin
  select * into v_entry from entries where id = p_entry_id;
  if not found or not app_can_see_entry(p_entry_id) then
    raise exception 'entry % not found', p_entry_id;
  end if;
  if v_role = 'owner' then
    return;
  end if;
  if exists (select 1 from entry_events where entry_id = p_entry_id and kind = 'verified') then
    raise exception 'entry % is verified; only the owner can change it', v_entry.serial;
  end if;
  if v_lock is not null and v_entry.entry_date <= v_lock then
    raise exception 'entry % is in locked books; only the owner can change it', v_entry.serial;
  end if;
  if v_entry.created_by <> auth.uid() and v_role <> 'office' then
    raise exception 'you cannot change entry %', v_entry.serial;
  end if;
  if v_role = 'office' and exists (
    select 1 from entry_lines where entry_id = p_entry_id and firm_id is not null and not app_has_firm(firm_id)
  ) then
    raise exception 'entry % is in another firm''s books too; someone with both firms must change it', v_entry.serial;
  end if;
end $$;

create or replace function app_assert_can_post(p_entry jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_role app_role := app_assert_signed_in();
  v_type text := p_entry ->> 'entryType';
  v_lock date := current_lock_date();
  v_line jsonb;
begin
  if v_role = 'owner' then
    return;
  end if;
  if v_lock is not null and (p_entry ->> 'entryDate')::date <= v_lock then
    raise exception 'books are locked through %; only the owner can post on or before that date', v_lock;
  end if;

  if v_role = 'office' then
    if v_type not in ('vendor_bill', 'vendor_payment', 'client_bill', 'client_receipt', 'cash_transfer', 'not_yet_known',
                      'firm_transfer', 'labour_supplied', 'machine_rent') then
      raise exception 'office staff cannot post % entries', v_type;
    end if;
    if nullif(p_entry ->> 'firmId', '') is not null and not app_has_firm((p_entry ->> 'firmId')::uuid) then
      raise exception 'you are not assigned to every firm in this entry';
    end if;
    for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
      if (nullif(v_line ->> 'firmId', '') is not null and not app_has_firm((v_line ->> 'firmId')::uuid))
         or (nullif(v_line ->> 'counterFirmId', '') is not null
             and not app_has_firm((v_line ->> 'counterFirmId')::uuid)) then
        raise exception 'you are not assigned to every firm in this entry';
      end if;
    end loop;
    return;
  end if;

  if v_role <> 'supervisor' then
    raise exception 'you cannot post entries';
  end if;

  if v_type not in ('site_cash_expense', 'cash_close_difference') then
    raise exception 'supervisors cannot post % entries', v_type;
  end if;
  for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
    if v_line ->> 'account' not in ('money', 'site_cost', 'cash_short_excess') then
      raise exception 'supervisor entries can only use your cash and site costs';
    end if;
    if v_line ->> 'account' = 'money' and not exists (
      select 1 from money_accounts
      where id = nullif(v_line ->> 'moneyAccountId', '')::uuid
        and kind = 'supervisor_cash' and holder_user_id = auth.uid()
    ) then
      raise exception 'supervisors can only spend from their own cash';
    end if;
    if nullif(v_line ->> 'firmId', '') is not null and not exists (
      select 1 from money_accounts
      where firm_id = (v_line ->> 'firmId')::uuid and kind = 'supervisor_cash' and holder_user_id = auth.uid()
    ) then
      raise exception 'supervisor entries can only use the firm of your own cash';
    end if;
    if nullif(v_line ->> 'siteId', '') is not null and not app_has_site((v_line ->> 'siteId')::uuid) then
      raise exception 'you are not assigned to this site';
    end if;
  end loop;
end $$;

-- 5. The running account of each pair of firms, from each one's side: above zero the other firm owes this one.
create view firm_rows with (security_invoker = true) as
with rows as (
  select entry_id, firm_id, counter_firm_id, sum(amount_paise)::bigint as amount_paise
  from entry_lines where account = 'inter_firm' group by entry_id, firm_id, counter_firm_id
)
select
  r.firm_id, r.counter_firm_id, r.entry_id, e.serial, e.entry_type, e.entry_date, e.party_id, e.reference, e.narration,
  r.amount_paise,
  (sum(r.amount_paise) over w)::bigint as balance_paise,
  row_number() over w as position,
  (select l.money_account_id from entry_lines l where l.entry_id = r.entry_id and l.account = 'money' limit 1) as money_account_id,
  (select l.site_id from entry_lines l where l.entry_id = r.entry_id and l.account = 'site_cost' limit 1) as site_id
from rows r
join entries e on e.id = r.entry_id
join entry_status s on s.entry_id = e.id
where s.status in ('verified', 'unverified') and r.amount_paise <> 0
window w as (partition by r.firm_id, r.counter_firm_id order by e.entry_date, (e.entry_type <> 'opening'), e.created_at, r.entry_id);
grant select on firm_rows to authenticated;

-- A bankbook line that crosses firms names the other one.
create or replace view money_rows with (security_invoker = true) as
with rows as (
  select
    l.money_account_id, l.firm_id, l.entry_id, sum(l.amount_paise)::bigint as amount_paise
  from entry_lines l
  where l.account = 'money'
  group by l.money_account_id, l.firm_id, l.entry_id
)
select
  r.money_account_id, r.firm_id, r.entry_id, e.serial, e.entry_type, e.entry_date, e.party_id, e.reference, e.narration,
  r.amount_paise,
  (sum(r.amount_paise) over w)::bigint as balance_paise,
  row_number() over w as position,
  e.created_at,
  (select o.money_account_id from entry_lines o
   where o.entry_id = r.entry_id and o.account = 'money' and o.money_account_id <> r.money_account_id limit 1) as other_account_id,
  (select c.site_id from entry_lines c where c.entry_id = r.entry_id and c.account = 'site_cost' order by c.line_no limit 1) as site_id,
  (select o.counter_firm_id from entry_lines o
   where o.entry_id = r.entry_id and o.account = 'inter_firm' and o.firm_id = r.firm_id limit 1) as counter_firm_id
from rows r
join money_accounts a on a.id = r.money_account_id
join entries e on e.id = r.entry_id
join entry_status s on s.entry_id = e.id
where s.status in ('verified', 'unverified') and r.amount_paise <> 0
window w as (partition by r.money_account_id order by e.entry_date, (e.entry_type <> 'opening'), e.created_at, r.entry_id);

-- Where the money went: each firm's money in and out by kind and month. `between` marks what crossed to another of our
-- firms: in an all-firms total a firm_transfer cancels out, while another firm's bill paid is still a party paid.
create view money_flow with (security_invoker = true) as
select
  firm_id, to_char(entry_date, 'YYYY-MM') as month, entry_type, counter_firm_id is not null as between_firms,
  coalesce(sum(amount_paise) filter (where amount_paise > 0), 0)::bigint as in_paise,
  coalesce(-sum(amount_paise) filter (where amount_paise < 0), 0)::bigint as out_paise
from money_rows
where firm_id is not null
group by 1, 2, 3, 4;
grant select on money_flow to authenticated;

-- 6. The GST and TDS records take in supplies between our firms: the taker's side reads like a party's bill, the
-- supplier's like a bill to a client, and the other firm is named where a party would be.
create or replace view gst_rows with (security_invoker = true) as
select
  e.id as entry_id, e.serial,
  (case when count(*) filter (where l.account = 'gst_input') > 0 then 'vendor_bill' else 'client_bill' end)::entry_type as entry_type,
  e.entry_date, e.reference, l.firm_id, e.party_id,
  case when count(*) filter (where l.account = 'gst_input') > 0
    then coalesce(sum(l.amount_paise) filter (where l.account in ('site_cost', 'company_assets')), 0)
    else -coalesce(sum(l.amount_paise) filter (where l.account in ('contract_income', 'firm_income')), 0)
  end::bigint as base_paise,
  abs(sum(l.amount_paise) filter (where l.account in ('gst_input', 'gst_output')))::bigint as gst_paise,
  max(l.counter_firm_id::text)::uuid as counter_firm_id
from entries e
join entry_lines l on l.entry_id = e.id
join entry_status s on s.entry_id = e.id
where s.status in ('verified', 'unverified') and e.entry_type in ('vendor_bill', 'client_bill', 'labour_supplied', 'machine_rent')
group by e.id, l.firm_id
having count(*) filter (where l.account in ('gst_input', 'gst_output')) > 0;

create or replace view tds_rows with (security_invoker = true) as
select
  e.id as entry_id, e.serial, e.entry_type, e.entry_date, e.reference, e.firm_id, e.party_id, s.status,
  t.section, t.rate_bp, t.base_paise, t.tds_paise, null::uuid as counter_firm_id
from bill_tds t
join entries e on e.id = t.entry_id
join entry_status s on s.entry_id = e.id
where s.status in ('verified', 'unverified')
union all
select
  e.id, e.serial,
  (case when count(*) filter (where l.account = 'tds_payable') > 0 then 'vendor_bill' else 'client_bill' end)::entry_type,
  e.entry_date, e.reference, l.firm_id, null, s.status, '',
  round(abs(sum(l.amount_paise) filter (where l.account in ('tds_payable', 'tds_claimable'))) * 10000.0
    / abs(sum(l.amount_paise) filter (where l.account in ('site_cost', 'firm_income'))))::integer,
  abs(sum(l.amount_paise) filter (where l.account in ('site_cost', 'firm_income')))::bigint,
  abs(sum(l.amount_paise) filter (where l.account in ('tds_payable', 'tds_claimable')))::bigint,
  max(l.counter_firm_id::text)::uuid
from entries e
join entry_lines l on l.entry_id = e.id
join entry_status s on s.entry_id = e.id
where s.status in ('verified', 'unverified') and e.entry_type in ('labour_supplied', 'machine_rent')
group by e.id, l.firm_id, s.status
having count(*) filter (where l.account in ('tds_payable', 'tds_claimable')) > 0;

-- 7. Labour supplied: where each worker's days were, and what is charged for them.
-- A place is one of our firms' sites, or an outside customer. Its name is kept on it, as a Labour login cannot read
-- firms, sites or clients.
create table labour_places (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  firm_id uuid references firms (id),
  site_id uuid references sites (id),
  client_id uuid references parties (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((firm_id is null) = (site_id is null) and (firm_id is null) <> (client_id is null))
);
create unique index labour_places_site on labour_places (firm_id, site_id) where firm_id is not null;
create unique index labour_places_client on labour_places (client_id) where client_id is not null;
create trigger labour_places_audit after insert or update or delete on labour_places
  for each row execute function log_master_change('id');
alter table labour_places enable row level security;
create policy labour_places_read on labour_places for select to authenticated using (app_labour_access());
create policy labour_places_write on labour_places for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));
grant select, insert, update on labour_places to authenticated;

alter table labour_workers add column place_id uuid references labour_places (id);
-- How the salary is said: by the day, or by the hour (an 8-hour day either way; the day's salary is what is kept).
alter table labour_workers add column rate_unit text not null default 'day' check (rate_unit in ('day', 'hour'));

-- One place for a month: all its days. Several: the days and OT at each, which must add up to the month's.
create table labour_month_places (
  worker_id uuid not null references labour_workers (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  place_id uuid not null references labour_places (id),
  days numeric(5, 2) not null default 0 check (days between 0 and 100),
  ot_hours numeric(6, 2) not null default 0 check (ot_hours between 0 and 999),
  primary key (worker_id, month, place_id)
);
create trigger labour_month_places_audit after insert or update or delete on labour_month_places
  for each row execute function log_master_change('worker_id');
alter table labour_month_places enable row level security;
create policy labour_month_places_all on labour_month_places for all to authenticated
  using (app_labour_access()) with check (app_labour_access());
grant select, insert, update, delete on labour_month_places to authenticated;

-- What a day is charged at, from a month on. Empty: the day's salary, as before any charged rate. Not for Labour logins.
create table labour_charge_rates (
  worker_id uuid not null references labour_workers (id) on delete cascade,
  from_month date not null check (extract(day from from_month) = 1),
  rate_paise bigint check (rate_paise > 0),
  primary key (worker_id, from_month)
);
create trigger labour_charge_rates_audit after insert or update or delete on labour_charge_rates
  for each row execute function log_master_change('worker_id');
alter table labour_charge_rates enable row level security;
create policy labour_charge_rates_all on labour_charge_rates for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));
grant select, insert, update, delete on labour_charge_rates to authenticated;
