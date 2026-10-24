-- The party pages, laid out like the owner's outstanding workbook: per firm and vendor, the
-- opening balance, each bill and each payment. Read-only views over the ledger; cancelled
-- entries and their reversals cancel out, so both are left out.

create view party_rows with (security_invoker = true) as
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
  (select m.money_account_id from entry_lines m where m.entry_id = e.id and m.account = 'money' limit 1) as money_account_id
from entry_lines l
join entries e on e.id = l.entry_id
join entry_status s on s.entry_id = e.id
where l.account = 'vendor_payable' and s.status in ('verified', 'unverified');

-- One row per firm and vendor: the workbook's Index sheet.
create view party_totals with (security_invoker = true) as
select
  firm_id,
  party_id,
  coalesce(sum(amount_paise) filter (where entry_type = 'opening'), 0)::bigint as opening_paise,
  coalesce(sum(amount_paise) filter (where entry_type = 'vendor_bill'), 0)::bigint as bills_paise,
  coalesce(sum(amount_paise) filter (where entry_type = 'vendor_payment'), 0)::bigint as paid_paise,
  max(entry_date) filter (where entry_type = 'vendor_payment') as last_payment
from party_rows
group by firm_id, party_id;

grant select on party_rows, party_totals to authenticated;
