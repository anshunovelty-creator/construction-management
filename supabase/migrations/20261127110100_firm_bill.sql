-- A bill between our firms (owner decision 2026-11-27): the taker's site cost and the biller's firm_income, of any cost
-- head (was labour and machine hire only), with GST and TDS naming the other firm, and the two firms' dues mirrored.

-- 1. firm_income may be of any cost head.
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
      and cost_head is not null
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
    when 'firm_cost' then
      firm_id is not null and cost_head is not null and counter_firm_id is null and money_account_id is null
      and party_id is null and site_id is null and work_order_id is null
    when 'other_income' then
      firm_id is not null and cost_head is not null and counter_firm_id is null and money_account_id is null
      and party_id is null and site_id is null and work_order_id is null
    when 'wages_paid' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'loan' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'deposit_given' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'gst_paid' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'tds_paid' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'pf_paid' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'tds_claimed' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'round_off' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
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

-- 2. A bill between firms may carry the dues between them.
create or replace function entry_lines_firms_independent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.account in ('inter_firm', 'firm_income') and not exists (
    select 1 from entries where id = new.entry_id
      and entry_type in ('firm_transfer', 'labour_supplied', 'machine_rent', 'firm_bill', 'vendor_payment', 'opening', 'reversal')
  ) then
    raise exception 'this kind of entry cannot move money between firms';
  end if;
  return new;
end $$;

-- 3. Office staff may add one, as they add labour supplied and machine rent.
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
                      'firm_transfer', 'labour_supplied', 'machine_rent', 'firm_bill', 'wages_paid', 'other_in', 'other_out',
                      'site_cash_expense') then
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

-- 4. Its GST and TDS show in both firms' records, like labour supplied.
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
where s.status in ('verified', 'unverified') and e.entry_type in ('vendor_bill', 'client_bill', 'labour_supplied', 'machine_rent', 'firm_bill')
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
where s.status in ('verified', 'unverified') and e.entry_type in ('labour_supplied', 'machine_rent', 'firm_bill')
group by e.id, l.firm_id, s.status
having count(*) filter (where l.account in ('tds_payable', 'tds_claimable')) > 0;
