-- Only Cash and Bank (owner decision 2026-11-24): a firm has one cash account and any number of banks, each its own.
-- Cash with a person is no longer added; the kind stays in the database for what older entries used.

create function money_account_kinds() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.kind = 'supervisor_cash' and auth.uid() is not null then
    raise exception 'an account is a bank or cash';
  end if;
  if new.kind = 'owner_cash' and new.is_active and new.firm_id is not null then
    -- Two at once wait for each other on the firm.
    perform 1 from firms where id = new.firm_id for update;
    if exists (select 1 from money_accounts where kind = 'owner_cash' and is_active and firm_id = new.firm_id and id <> new.id) then
      raise exception 'this firm already has its cash account';
    end if;
  end if;
  return new;
end $$;
create trigger money_account_kinds before insert or update of kind, firm_id, is_active on money_accounts
  for each row execute function money_account_kinds();

-- A site's cost typed as not paid yet (a supervisor holds no account), paid later by the owner or the office: the line is
-- taken off and put back with the entry that paid it, in one step, so it is never counted twice or lost.
create function app_pay_cost(p_cost uuid, p_entry jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cost other_cost%rowtype;
  v_result jsonb;
begin
  perform app_assert_signed_in();
  if app_my_role() not in ('owner', 'office') then
    raise exception 'you cannot pay a site''s cost';
  end if;
  -- A retry after a lost connection: the line is already paid by this entry.
  if exists (select 1 from entries where id = (p_entry ->> 'id')::uuid and created_by = auth.uid()) then
    return jsonb_build_object('id', p_entry ->> 'id', 'duplicate', true);
  end if;
  select * into v_cost from other_cost where id = p_cost for update;
  if v_cost.id is null or v_cost.entry_id is not null then
    raise exception 'this cost is already paid or removed';
  end if;
  if not app_has_site(v_cost.site_id) then
    raise exception 'you are not assigned to this site';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_entry -> 'lines') l
      where l ->> 'siteId' = v_cost.site_id::text and l ->> 'costHead' = v_cost.cost_head::text and (l ->> 'amountPaise')::bigint = v_cost.amount_paise) then
    raise exception 'the entry does not pay this cost';
  end if;
  delete from other_cost where id = p_cost;
  v_result := app_pay(jsonb_build_array(jsonb_build_object('entry', p_entry, 'lines', jsonb_build_array(jsonb_build_object(
    'source', 'other_cost', 'siteId', v_cost.site_id, 'date', v_cost.work_date, 'description', v_cost.description,
    'costHead', v_cost.cost_head, 'quantity', v_cost.quantity, 'ratePaise', v_cost.rate_paise, 'amountPaise', v_cost.amount_paise)))));
  return v_result -> 0;
end $$;
revoke all on function app_pay_cost(uuid, jsonb) from public, anon;
grant execute on function app_pay_cost(uuid, jsonb) to authenticated;
