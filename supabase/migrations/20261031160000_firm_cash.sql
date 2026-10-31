-- Firms are independent for money (20261029150000), so each firm keeps its own cash: an owner cash account may now
-- belong to a firm. Banks still always belong to one; supervisor cash still belongs to none. The old rule (only banks
-- have a firm) refused "Jayraj Infra - Cash". Existing rows all fit the new rule, including common "Owner cash".
alter table money_accounts drop constraint money_accounts_check;
alter table money_accounts add constraint money_accounts_check check (
  (kind <> 'bank' or firm_id is not null) and (kind <> 'supervisor_cash' or firm_id is null)
);
