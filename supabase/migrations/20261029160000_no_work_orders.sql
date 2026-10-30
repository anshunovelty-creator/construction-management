-- Work orders are set aside (owner decision 2026-10-29): a client bill names the client and the site directly,
-- and a receipt names the client. The work_orders table and the work_order_id column stay, for the entries
-- already made with them; new client lines simply leave work_order_id empty.

-- Client lines need the firm and the client. Billed income also needs the site, so site profit still works.
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
    when 'contract_income' then
      firm_id is not null and party_id is not null and site_id is not null
      and counter_firm_id is null and money_account_id is null and cost_head is null
    -- client_receivable, retention_held, security_deposit_held, tds_claimable: the site is optional
    else
      firm_id is not null and party_id is not null
      and counter_firm_id is null and money_account_id is null and cost_head is null
  end
);

-- The client pages read the firm, client and site from the ledger lines, not from a work order.
create or replace view client_rows with (security_invoker = true) as
select
  e.id as entry_id,
  e.serial,
  e.entry_type,
  e.entry_date,
  e.reference,
  e.narration,
  s.status,
  c.firm_id,
  c.party_id,
  max(l.work_order_id::text)::uuid as work_order_id,
  max(l.site_id::text)::uuid as site_id,
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
  select x.firm_id, x.party_id from entry_lines x
  where x.entry_id = e.id
    and x.account in ('client_receivable', 'contract_income', 'tds_claimable', 'retention_held', 'security_deposit_held')
  order by x.line_no limit 1
) c on true
join entry_lines l on l.entry_id = e.id
where e.entry_type in ('opening', 'client_bill', 'client_receipt') and s.status in ('verified', 'unverified')
group by e.id, s.status, c.firm_id, c.party_id;
