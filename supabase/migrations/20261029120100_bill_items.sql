-- Bills with item lines, like a Tally invoice: each line is a material, a quantity, a rate and a GST rate.
-- The ledger lines stay the source of truth for money; the items say what the bill was for and must add up to them.

-- GST rates the owner keeps in Setup; each bill line picks one.
create table gst_rates (
  id uuid primary key default gen_random_uuid(),
  rate_bp integer not null unique check (rate_bp between 0 and 10000),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create trigger gst_rates_audit after insert or update or delete on gst_rates
  for each row execute function log_master_change('id');

alter table gst_rates enable row level security;
create policy gst_rates_read on gst_rates for select to authenticated using (app_my_role() is not null);
create policy gst_rates_owner on gst_rates for all to authenticated using (app_is_owner()) with check (app_is_owner());
grant select, insert, update on gst_rates to authenticated;

insert into gst_rates (rate_bp) values (0), (500), (1200), (1800), (2800);

-- GST lines belong to a firm and the vendor or client on the bill, nothing else.
alter table entry_lines drop constraint line_dimensions;
alter table entry_lines add constraint line_dimensions check (
  case account
    when 'money' then
      money_account_id is not null and counter_firm_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'vendor_payable' then
      firm_id is not null and party_id is not null and counter_firm_id is null
      and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
    when 'gst_input' then
      firm_id is not null and party_id is not null and counter_firm_id is null
      and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
    when 'gst_output' then
      firm_id is not null and party_id is not null and counter_firm_id is null
      and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
    when 'inter_firm' then
      firm_id is not null and counter_firm_id is not null and firm_id <> counter_firm_id
      and money_account_id is null and party_id is null and site_id is null
      and work_order_id is null and cost_head is null
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
    -- client_receivable, retention_held, security_deposit_held, tds_claimable, contract_income
    else
      firm_id is not null and party_id is not null and site_id is not null and work_order_id is not null
      and counter_firm_id is null and money_account_id is null and cost_head is null
  end
);

-- A bill's item lines. Append-only like the ledger; the amounts are checked against quantity × rate here.
create table bill_items (
  id bigint generated always as identity primary key,
  entry_id uuid not null references entries (id),
  line_no smallint not null check (line_no > 0),
  material_id uuid not null references materials (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  rate_paise bigint not null check (rate_paise > 0),
  gst_bp integer not null check (gst_bp between 0 and 10000),
  amount_paise bigint not null check (amount_paise > 0),
  gst_paise bigint not null,
  unique (entry_id, line_no),
  check (amount_paise = round(quantity * rate_paise)),
  check (gst_paise = round(amount_paise * gst_bp / 10000.0))
);

create trigger bill_items_append_only before update or delete on bill_items
  for each row execute function reject_change();
create trigger bill_items_no_truncate before truncate on bill_items
  for each statement execute function reject_change();

create function bill_items_check() returns trigger
language plpgsql as $$
begin
  if (select created_txid from entries where id = new.entry_id) is distinct from txid_current() then
    raise exception 'items can only be added in the transaction that creates entry %', new.entry_id;
  end if;
  return new;
end $$;

create trigger bill_items_check before insert on bill_items
  for each row execute function bill_items_check();

alter table bill_items enable row level security;
create policy bill_items_read on bill_items for select to authenticated using (app_can_see_entry(entry_id));
grant select on bill_items to authenticated;

-- Same as before, now also storing a bill's items and checking they add up to its lines.
create or replace function insert_entry(p_entry jsonb, p_actor uuid, p_override_reason text) returns jsonb
language plpgsql as $$
declare
  v_id uuid := (p_entry ->> 'id')::uuid;
  v_type text := p_entry ->> 'entryType';
  v_date date := (p_entry ->> 'entryDate')::date;
  v_firm uuid := nullif(p_entry ->> 'firmId', '')::uuid;
  v_lock date := current_lock_date();
  v_series text;
  v_fy text;
  v_seq integer;
  v_serial text;
  v_line jsonb;
  v_line_no integer := 0;
  v_sum bigint;
  v_item jsonb;
  v_items_base bigint;
  v_items_gst bigint;
  v_lines_base bigint;
  v_lines_gst bigint;
begin
  if v_id is null then
    raise exception 'entry id is required';
  end if;
  if v_date is null then
    raise exception 'entry date is required';
  end if;
  if p_actor is null then
    raise exception 'actor is required';
  end if;
  if jsonb_typeof(p_entry -> 'lines') is distinct from 'array' or jsonb_array_length(p_entry -> 'lines') < 2 then
    raise exception 'an entry needs at least two lines';
  end if;

  select coalesce(sum((l ->> 'amountPaise')::bigint), 0)::bigint into v_sum
  from jsonb_array_elements(p_entry -> 'lines') l;
  if v_sum <> 0 then
    raise exception 'entry does not balance: lines sum to % paise', v_sum;
  end if;

  if v_lock is not null and v_date <= v_lock and coalesce(btrim(p_override_reason), '') = '' then
    raise exception 'books are locked through %; a reason is required to post on %', v_lock, v_date;
  end if;

  if v_firm is null then
    v_series := 'CM';
  else
    select code into v_series from firms where id = v_firm;
    if v_series is null then
      raise exception 'unknown firm %', v_firm;
    end if;
  end if;

  v_fy := fy_label(v_date);
  v_seq := next_serial(v_series, v_fy);
  v_serial := v_series || '/' || v_fy || '/' || lpad(v_seq::text, 6, '0');

  insert into entries (
    id, serial, series, fy, seq, entry_type, entry_date, firm_id, party_id,
    reference, narration, reverses_entry_id, replaces_entry_id, created_by, material_id
  ) values (
    v_id, v_serial, v_series, v_fy, v_seq, v_type::entry_type, v_date, v_firm,
    nullif(p_entry ->> 'partyId', '')::uuid,
    coalesce(p_entry ->> 'reference', ''),
    coalesce(p_entry ->> 'narration', ''),
    nullif(p_entry ->> 'reversesEntryId', '')::uuid,
    nullif(p_entry ->> 'replacesEntryId', '')::uuid,
    p_actor,
    nullif(p_entry ->> 'materialId', '')::uuid
  );

  for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
    v_line_no := v_line_no + 1;
    insert into entry_lines (
      entry_id, line_no, account, amount_paise, firm_id, counter_firm_id,
      money_account_id, party_id, site_id, work_order_id, cost_head
    ) values (
      v_id, v_line_no,
      (v_line ->> 'account')::ledger_account,
      (v_line ->> 'amountPaise')::bigint,
      nullif(v_line ->> 'firmId', '')::uuid,
      nullif(v_line ->> 'counterFirmId', '')::uuid,
      nullif(v_line ->> 'moneyAccountId', '')::uuid,
      nullif(v_line ->> 'partyId', '')::uuid,
      nullif(v_line ->> 'siteId', '')::uuid,
      nullif(v_line ->> 'workOrderId', '')::uuid,
      nullif(v_line ->> 'costHead', '')::cost_head
    );
  end loop;

  if jsonb_typeof(p_entry -> 'items') = 'array' and jsonb_array_length(p_entry -> 'items') > 0 then
    if v_type not in ('vendor_bill', 'client_bill') then
      raise exception 'only bills have items';
    end if;
    v_line_no := 0;
    for v_item in select * from jsonb_array_elements(p_entry -> 'items') loop
      v_line_no := v_line_no + 1;
      insert into bill_items (entry_id, line_no, material_id, quantity, rate_paise, gst_bp, amount_paise, gst_paise)
      values (
        v_id, v_line_no,
        (v_item ->> 'materialId')::uuid,
        (v_item ->> 'quantityMilli')::numeric / 1000,
        (v_item ->> 'ratePaise')::bigint,
        (v_item ->> 'gstBp')::integer,
        (v_item ->> 'amountPaise')::bigint,
        (v_item ->> 'gstPaise')::bigint
      );
    end loop;

    -- The items must say the same as the money: before GST is the site cost (vendor) or the income (client).
    select coalesce(sum(amount_paise), 0)::bigint, coalesce(sum(gst_paise), 0)::bigint
    into v_items_base, v_items_gst from bill_items where entry_id = v_id;
    select
      coalesce(sum(case
        when account = 'site_cost' and v_type = 'vendor_bill' then amount_paise
        when account = 'contract_income' then -amount_paise
        else 0 end), 0)::bigint,
      coalesce(sum(case
        when account = 'gst_input' then amount_paise
        when account = 'gst_output' then -amount_paise
        else 0 end), 0)::bigint
    into v_lines_base, v_lines_gst from entry_lines where entry_id = v_id;
    if v_items_base <> v_lines_base or v_items_gst <> v_lines_gst then
      raise exception 'the bill items (% before GST, % GST) do not match the entry (%, %)',
        v_items_base, v_items_gst, v_lines_base, v_lines_gst;
    end if;
  end if;

  if v_lock is not null and v_date <= v_lock then
    insert into entry_events (entry_id, kind, actor, reason)
    values (v_id, 'lock_override', p_actor, p_override_reason);
  end if;

  return jsonb_build_object('id', v_id, 'serial', v_serial, 'duplicate', false);
end $$;

-- The party pages also list what each bill was for, from its items.
create or replace view party_rows with (security_invoker = true) as
select
  e.id as entry_id,
  e.serial,
  e.entry_type,
  e.entry_date,
  e.reference,
  e.narration,
  s.status,
  l.firm_id,
  l.party_id,
  -- Positive: a bill or opening (we owe more) or a payment (we paid), as the workbook shows them.
  case when e.entry_type = 'vendor_payment' then l.amount_paise else -l.amount_paise end as amount_paise,
  (select c.site_id from entry_lines c where c.entry_id = e.id and c.account = 'site_cost' order by c.line_no limit 1) as site_id,
  (select c.cost_head from entry_lines c where c.entry_id = e.id and c.account = 'site_cost' order by c.line_no limit 1) as cost_head,
  (select m.money_account_id from entry_lines m where m.entry_id = e.id and m.account = 'money' limit 1) as money_account_id,
  e.material_id,
  (select string_agg(mt.name, ', ' order by i.line_no) from bill_items i join materials mt on mt.id = i.material_id
   where i.entry_id = e.id) as item_names
from entry_lines l
join entries e on e.id = l.entry_id
join entry_status s on s.entry_id = e.id
where l.account = 'vendor_payable' and s.status in ('verified', 'unverified');

-- A client bill's amount now includes the GST on it; gst_paise says how much of it that is.
create or replace view client_rows with (security_invoker = true) as
select
  e.id as entry_id,
  e.serial,
  e.entry_type,
  e.entry_date,
  e.reference,
  e.narration,
  s.status,
  w.firm_id,
  w.client_id as party_id,
  w.id as work_order_id,
  w.site_id,
  coalesce(-sum(l.amount_paise) filter (where l.account in ('contract_income', 'gst_output')), 0)::bigint as gross_paise,
  coalesce(sum(l.amount_paise) filter (where l.account = 'tds_claimable'), 0)::bigint as tds_paise,
  coalesce(sum(l.amount_paise) filter (where l.account = 'retention_held'), 0)::bigint as retention_paise,
  coalesce(sum(l.amount_paise) filter (where l.account = 'security_deposit_held'), 0)::bigint as deposit_paise,
  -- Material recoveries and penalties the client cut from a bill.
  coalesce(sum(l.amount_paise) filter (where l.account = 'site_cost'), 0)::bigint as other_cut_paise,
  -- Positive: the client owes us more (opening, bill). Negative: money received.
  coalesce(sum(l.amount_paise) filter (where l.account = 'client_receivable'), 0)::bigint as receivable_paise,
  max(l.money_account_id::text)::uuid as money_account_id,
  coalesce(-sum(l.amount_paise) filter (where l.account = 'gst_output'), 0)::bigint as gst_paise
from entries e
join entry_status s on s.entry_id = e.id
join lateral (
  select x.work_order_id from entry_lines x where x.entry_id = e.id and x.work_order_id is not null limit 1
) wo on true
join work_orders w on w.id = wo.work_order_id
join entry_lines l on l.entry_id = e.id
where e.entry_type in ('opening', 'client_bill', 'client_receipt') and s.status in ('verified', 'unverified')
group by e.id, s.status, w.id;
