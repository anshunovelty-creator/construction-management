-- Bank charges in one place (owner decision 2026-11-28): every live charge of a firm, whether typed with a party
-- payment (the Pay pop-up's Bank charges box) or entered on its own (Something else → Bank charges), with the bank it
-- came out of. A charge is a firm_cost line with head bank_charges; the bank is the entry's money line in that firm.

create view bank_charge_rows with (security_invoker = true) as
select
  e.id as entry_id, e.serial, e.entry_type, e.entry_date, e.reference, e.narration, l.firm_id, e.party_id,
  p.name as party_name,
  sum(l.amount_paise)::bigint as charges_paise,
  (select m.money_account_id from entry_lines m
   where m.entry_id = e.id and m.account = 'money' and m.firm_id = l.firm_id order by m.line_no limit 1) as money_account_id,
  e.created_at
from entries e
join entry_lines l on l.entry_id = e.id
join entry_status s on s.entry_id = e.id
left join parties p on p.id = e.party_id
where s.status in ('verified', 'unverified') and l.account = 'firm_cost' and l.cost_head = 'bank_charges'
group by e.id, l.firm_id, p.name;

grant select on bank_charge_rows to authenticated;
