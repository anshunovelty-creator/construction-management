-- TDS on bills, by rate. A vendor bill's TDS is ours to pay to the government (tds_payable); a client
-- deducts TDS from our bill and we claim it back (tds_claimable). It is worked out on the bill before GST,
-- and each bill keeps its rate, section and amounts in bill_tds for the TDS record.

-- TDS rates the owner keeps in Setup; a bill picks one. 0% means no TDS.
create table tds_rates (
  id uuid primary key default gen_random_uuid(),
  rate_bp integer not null unique check (rate_bp between 0 and 10000),
  section text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create trigger tds_rates_audit after insert or update or delete on tds_rates
  for each row execute function log_master_change('id');

alter table tds_rates enable row level security;
create policy tds_rates_read on tds_rates for select to authenticated using (app_my_role() is not null);
create policy tds_rates_owner on tds_rates for all to authenticated using (app_is_owner()) with check (app_is_owner());
grant select, insert, update on tds_rates to authenticated;

insert into tds_rates (rate_bp, section) values
  (0, 'no TDS'),
  (100, '194C, individual or HUF'),
  (200, '194C, company'),
  (1000, '194J, professional');

-- TDS lines belong to a firm and the vendor on the bill, like GST lines.
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
    when 'tds_payable' then
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

-- A bill's TDS: the rate used, its section, the base it was worked out on (before GST) and the TDS itself.
-- Append-only, and written only in the transaction that creates the bill (see insert_entry).
create table bill_tds (
  entry_id uuid primary key references entries (id),
  rate_bp integer not null check (rate_bp between 0 and 10000),
  section text not null default '',
  base_paise bigint not null check (base_paise > 0),
  tds_paise bigint not null check (tds_paise >= 0),
  check (tds_paise = round(base_paise * rate_bp / 10000.0))
);

create trigger bill_tds_append_only before update or delete on bill_tds
  for each row execute function reject_change();
create trigger bill_tds_no_truncate before truncate on bill_tds
  for each statement execute function reject_change();

create function bill_tds_check() returns trigger
language plpgsql as $$
begin
  if (select created_txid from entries where id = new.entry_id) is distinct from txid_current() then
    raise exception 'TDS can only be added in the transaction that creates entry %', new.entry_id;
  end if;
  return new;
end $$;

create trigger bill_tds_check before insert on bill_tds
  for each row execute function bill_tds_check();

alter table bill_tds enable row level security;
create policy bill_tds_read on bill_tds for select to authenticated using (app_can_see_entry(entry_id));
grant select on bill_tds to authenticated;

-- Same as before, now also storing a bill's TDS and checking it against the ledger lines.
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
  v_lines_tds bigint;
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

  if jsonb_typeof(p_entry -> 'tds') = 'object' then
    if v_type not in ('vendor_bill', 'client_bill') then
      raise exception 'only bills have TDS';
    end if;
    -- TDS is worked out on the bill before GST, and the ledger must carry the same TDS.
    select
      coalesce(sum(case
        when v_type = 'vendor_bill' and account = 'tds_payable' then -amount_paise
        when v_type = 'client_bill' and account = 'tds_claimable' then amount_paise
        else 0 end), 0)::bigint,
      coalesce(sum(case
        when account = 'site_cost' and v_type = 'vendor_bill' then amount_paise
        when account = 'contract_income' then -amount_paise
        else 0 end), 0)::bigint
    into v_lines_tds, v_lines_base from entry_lines where entry_id = v_id;
    if (p_entry -> 'tds' ->> 'tdsPaise')::bigint <> v_lines_tds
      or (p_entry -> 'tds' ->> 'basePaise')::bigint <> v_lines_base then
      raise exception 'the bill TDS (% on %) does not match the entry (% on %)',
        p_entry -> 'tds' ->> 'tdsPaise', p_entry -> 'tds' ->> 'basePaise', v_lines_tds, v_lines_base;
    end if;
    insert into bill_tds (entry_id, rate_bp, section, base_paise, tds_paise)
    values (
      v_id,
      (p_entry -> 'tds' ->> 'rateBp')::integer,
      coalesce(p_entry -> 'tds' ->> 'section', ''),
      (p_entry -> 'tds' ->> 'basePaise')::bigint,
      (p_entry -> 'tds' ->> 'tdsPaise')::bigint
    );
  end if;

  if v_lock is not null and v_date <= v_lock then
    insert into entry_events (entry_id, kind, actor, reason)
    values (v_id, 'lock_override', p_actor, p_override_reason);
  end if;

  return jsonb_build_object('id', v_id, 'serial', v_serial, 'duplicate', false);
end $$;

-- The TDS record: one row per bill that has TDS, for live entries only (cancelled bills drop off).
create view tds_rows with (security_invoker = true) as
select
  e.id as entry_id,
  e.serial,
  e.entry_type,
  e.entry_date,
  e.reference,
  e.firm_id,
  e.party_id,
  s.status,
  t.section,
  t.rate_bp,
  t.base_paise,
  t.tds_paise
from bill_tds t
join entries e on e.id = t.entry_id
join entry_status s on s.entry_id = e.id
where s.status in ('verified', 'unverified');

grant select on tds_rows to authenticated;
