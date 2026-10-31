-- A site's statement: one row per entry that put cost on the site or billed the client for work there.
-- cost_paise: spent at the site before GST (vendor bills, site cash spends, and material the client supplied and cut from a client bill).
-- billed_paise: the client bill's gross before GST.
-- firm_id is null for a common cost (paid from owner or supervisor cash, which belongs to no firm).
create view site_rows with (security_invoker = true) as
select
  e.id as entry_id,
  e.serial,
  e.entry_type,
  e.entry_date,
  e.reference,
  e.narration,
  s.status,
  l.site_id,
  l.firm_id,
  e.party_id,
  coalesce(sum(l.amount_paise) filter (where l.account = 'site_cost'), 0)::bigint as cost_paise,
  coalesce(-sum(l.amount_paise) filter (where l.account = 'contract_income'), 0)::bigint as billed_paise,
  (select string_agg(mt.name, ', ' order by i.line_no) from bill_items i join materials mt on mt.id = i.material_id
   where i.entry_id = e.id) as item_names
from entry_lines l
join entries e on e.id = l.entry_id
join entry_status s on s.entry_id = e.id
where l.account in ('site_cost', 'contract_income') and l.site_id is not null
  and s.status in ('verified', 'unverified')
group by e.id, s.status, l.site_id, l.firm_id;
