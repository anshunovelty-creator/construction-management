-- Three kinds of things on a party's bill (owner decision 2026-11-02):
--   consumable: sand, cement; goes into the site's stock and comes out on the daily report (as every item did so far);
--   asset: bought to keep and reuse (axes, bowls); goes to the company's assets, not the site's cost, and is
--          kept on the assets list by site, with moves between sites;
--   rented: hired things; the site's cost as usual, but never stock. Rentals are typed by hand on the Rentals page.
-- Each material has a kind, which a bill line takes unless it is changed on that line.

alter table materials add column item_kind text not null default 'consumable'
  check (item_kind in ('consumable', 'asset', 'rented'));
-- Every item bought so far went into stock, so it stays consumable.
alter table bill_items add column item_kind text not null default 'consumable'
  check (item_kind in ('consumable', 'asset', 'rented'));

-- Same as before, now also storing each item's kind and keeping assets out of the site's cost.
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
  v_items_assets bigint;
  v_lines_assets bigint;
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
      insert into bill_items (entry_id, line_no, material_id, quantity, rate_paise, gst_bp, amount_paise, gst_paise, item_kind)
      values (
        v_id, v_line_no,
        (v_item ->> 'materialId')::uuid,
        (v_item ->> 'quantityMilli')::numeric / 1000,
        (v_item ->> 'ratePaise')::bigint,
        (v_item ->> 'gstBp')::integer,
        (v_item ->> 'amountPaise')::bigint,
        (v_item ->> 'gstPaise')::bigint,
        coalesce(nullif(v_item ->> 'kind', ''), 'consumable')
      );
    end loop;

    -- Only a party's bill buys assets or rented things; a client's bill is for work done.
    if v_type = 'client_bill' and exists (select 1 from bill_items where entry_id = v_id and item_kind <> 'consumable') then
      raise exception 'a client bill''s items are all for work done';
    end if;
    -- The assets bought must be what goes to the company's assets, and the rest what goes to the site's cost.
    select coalesce(sum(amount_paise), 0)::bigint into v_items_assets
    from bill_items where entry_id = v_id and item_kind = 'asset';
    select coalesce(sum(amount_paise), 0)::bigint into v_lines_assets
    from entry_lines where entry_id = v_id and account = 'company_assets';
    if v_items_assets <> v_lines_assets then
      raise exception 'the assets on the bill (%) do not match the entry (%)', v_items_assets, v_lines_assets;
    end if;

    -- The items must say the same as the money: before GST is the site cost and assets (vendor) or the income (client).
    select coalesce(sum(amount_paise), 0)::bigint, coalesce(sum(gst_paise), 0)::bigint
    into v_items_base, v_items_gst from bill_items where entry_id = v_id;
    select
      coalesce(sum(case
        when account in ('site_cost', 'company_assets') and v_type = 'vendor_bill' then amount_paise
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
        when account in ('site_cost', 'company_assets') and v_type = 'vendor_bill' then amount_paise
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

-- Stock is consumables only.
create or replace view stock_in_rows with (security_invoker = true) as
select
  e.id as entry_id,
  i.line_no,
  e.serial,
  e.entry_date,
  e.reference,
  e.firm_id,
  e.party_id,
  s.status,
  (select c.site_id from entry_lines c where c.entry_id = e.id and c.account = 'site_cost' order by c.line_no limit 1) as site_id,
  i.material_id,
  i.quantity,
  i.rate_paise,
  i.amount_paise
from bill_items i
join entries e on e.id = i.entry_id
join entry_status s on s.entry_id = e.id
where e.entry_type = 'vendor_bill' and s.status in ('verified', 'unverified') and i.item_kind = 'consumable';

-- A party's bill of assets only has no site cost line: its site comes from the assets line.
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
  case when e.entry_type = 'vendor_payment' then l.amount_paise else -l.amount_paise end as amount_paise,
  (select c.site_id from entry_lines c where c.entry_id = e.id and c.account in ('site_cost', 'company_assets')
   order by c.line_no limit 1) as site_id,
  (select c.cost_head from entry_lines c where c.entry_id = e.id and c.account = 'site_cost' order by c.line_no limit 1) as cost_head,
  (select m.money_account_id from entry_lines m where m.entry_id = e.id and m.account = 'money' limit 1) as money_account_id,
  e.material_id,
  (select string_agg(mt.name, ', ' order by i.line_no) from bill_items i join materials mt on mt.id = i.material_id
   where i.entry_id = e.id) as item_names
from entry_lines l
join entries e on e.id = l.entry_id
join entry_status s on s.entry_id = e.id
where l.account = 'vendor_payable' and s.status in ('verified', 'unverified');

-- Assets bought, one row per bill line, at the site the bill named. A cancelled bill drops out with it.
create view asset_in_rows with (security_invoker = true) as
select
  e.id as entry_id,
  i.line_no,
  e.serial,
  e.entry_date,
  e.reference,
  e.firm_id,
  e.party_id,
  (select c.site_id from entry_lines c where c.entry_id = e.id and c.account = 'company_assets' order by c.line_no limit 1) as site_id,
  i.material_id,
  i.quantity,
  i.rate_paise,
  i.amount_paise
from bill_items i
join entries e on e.id = i.entry_id
join entry_status s on s.entry_id = e.id
where e.entry_type = 'vendor_bill' and s.status in ('verified', 'unverified') and i.item_kind = 'asset';

grant select on asset_in_rows to authenticated;

-- Assets taken from one site to another. What is at a site = bought there + moved in − moved out.
create table asset_moves (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  from_site_id uuid not null references sites (id),
  to_site_id uuid not null references sites (id) check (to_site_id <> from_site_id),
  move_date date not null,
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create index asset_moves_material on asset_moves (material_id);

create trigger asset_moves_audit after insert or update or delete on asset_moves
  for each row execute function log_master_change('id');

-- Everyone signed in sees where assets are; the owner and office move them, and take a wrong move off.
alter table asset_moves enable row level security;
create policy asset_moves_read on asset_moves for select to authenticated using (app_my_role() is not null);
create policy asset_moves_add on asset_moves for insert to authenticated
  with check (app_my_role() in ('owner', 'office') and created_by = auth.uid());
create policy asset_moves_remove on asset_moves for delete to authenticated using (app_my_role() in ('owner', 'office'));
grant select, insert, delete on asset_moves to authenticated;
