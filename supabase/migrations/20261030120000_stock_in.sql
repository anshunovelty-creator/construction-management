-- Stock in (owner decision 2026-10-30): what a party's bill was for goes into stock by itself, at the bill's site.
-- Nothing new is stored: the stock is read from the vendor bills' items. A cancelled bill drops out with it.

-- The unit a material is counted in (bags, tonnes, cft), shown beside its stock.
alter table materials add column unit text not null default '';

-- One row per item bought on a party's bill, for the stock page.
create view stock_in_rows with (security_invoker = true) as
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
where e.entry_type = 'vendor_bill' and s.status in ('verified', 'unverified');

grant select on stock_in_rows to authenticated;
