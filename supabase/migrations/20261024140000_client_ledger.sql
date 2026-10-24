-- The client pages, the mirror of the party pages: per firm and client, the opening amount
-- owed to us, each bill given (gross, deductions, net) and each receipt. Read-only views over
-- the ledger; cancelled entries and their reversals cancel out, so both are left out.

create view client_rows with (security_invoker = true) as
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
  coalesce(-sum(l.amount_paise) filter (where l.account = 'contract_income'), 0)::bigint as gross_paise,
  coalesce(sum(l.amount_paise) filter (where l.account = 'tds_claimable'), 0)::bigint as tds_paise,
  coalesce(sum(l.amount_paise) filter (where l.account = 'retention_held'), 0)::bigint as retention_paise,
  coalesce(sum(l.amount_paise) filter (where l.account = 'security_deposit_held'), 0)::bigint as deposit_paise,
  -- Material recoveries and penalties the client cut from a bill.
  coalesce(sum(l.amount_paise) filter (where l.account = 'site_cost'), 0)::bigint as other_cut_paise,
  -- Positive: the client owes us more (opening, bill). Negative: money received.
  coalesce(sum(l.amount_paise) filter (where l.account = 'client_receivable'), 0)::bigint as receivable_paise,
  max(l.money_account_id::text)::uuid as money_account_id
from entries e
join entry_status s on s.entry_id = e.id
join lateral (
  select x.work_order_id from entry_lines x where x.entry_id = e.id and x.work_order_id is not null limit 1
) wo on true
join work_orders w on w.id = wo.work_order_id
join entry_lines l on l.entry_id = e.id
where e.entry_type in ('opening', 'client_bill', 'client_receipt') and s.status in ('verified', 'unverified')
group by e.id, s.status, w.id;

-- One row per firm and client: the client version of the Index sheet.
create view client_totals with (security_invoker = true) as
select
  firm_id,
  party_id,
  coalesce(sum(receivable_paise) filter (where entry_type = 'opening'), 0)::bigint as opening_paise,
  coalesce(sum(gross_paise) filter (where entry_type = 'client_bill'), 0)::bigint as gross_paise,
  coalesce(sum(tds_paise + retention_paise + deposit_paise + other_cut_paise) filter (where entry_type = 'client_bill'), 0)::bigint
    as deductions_paise,
  coalesce(-sum(receivable_paise) filter (where entry_type = 'client_receipt'), 0)::bigint as received_paise,
  max(entry_date) filter (where entry_type = 'client_receipt') as last_receipt
from client_rows
group by firm_id, party_id;

grant select on client_rows, client_totals to authenticated;
