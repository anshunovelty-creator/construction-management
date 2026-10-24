-- Running balances: the sum of every ledger line, per account and dimension.
-- security_invoker makes the view obey entry_lines' row level security, so each user
-- only adds up the lines they are allowed to see.
create view balances with (security_invoker = true) as
select
  account, firm_id, counter_firm_id, money_account_id, party_id, site_id, work_order_id, cost_head,
  sum(amount_paise)::bigint as amount_paise
from entry_lines
group by account, firm_id, counter_firm_id, money_account_id, party_id, site_id, work_order_id, cost_head
having sum(amount_paise) <> 0;

grant select on balances to authenticated;
