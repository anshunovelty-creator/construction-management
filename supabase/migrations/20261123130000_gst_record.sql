-- The GST record (owner decision 2026-11-23), like the TDS record: one row per live bill with GST. Bills keep no GST
-- rate of their own (money-only bills, 2026-11-03), so the row reads the bill's ledger lines: GST from gst_input (a
-- party's bill, ours to claim back) or gst_output (our bill to a client, owed to the government), and the amount before
-- GST from the site cost and assets (party bill) or the contract income (client bill). Cancelled bills drop off.
-- A read-only view over the append-only ledger: nothing is stored or changed.

create view gst_rows with (security_invoker = true) as
select
  e.id as entry_id,
  e.serial,
  e.entry_type,
  e.entry_date,
  e.reference,
  e.firm_id,
  e.party_id,
  case when e.entry_type = 'vendor_bill'
    then coalesce(sum(l.amount_paise) filter (where l.account in ('site_cost', 'company_assets')), 0)
    else -coalesce(sum(l.amount_paise) filter (where l.account = 'contract_income'), 0)
  end::bigint as base_paise,
  abs(sum(l.amount_paise) filter (where l.account in ('gst_input', 'gst_output')))::bigint as gst_paise
from entries e
join entry_lines l on l.entry_id = e.id
join entry_status s on s.entry_id = e.id
where s.status in ('verified', 'unverified') and e.entry_type in ('vendor_bill', 'client_bill')
group by e.id
having count(*) filter (where l.account in ('gst_input', 'gst_output')) > 0;

grant select on gst_rows to authenticated;
