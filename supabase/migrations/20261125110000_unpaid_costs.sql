-- Costs typed as not paid yet can be found and settled in one place (Bankbook → Pay → Costs not paid yet): a site's other
-- cost, or a machine's service, is either paid then, or turns out to be on a party's bill, which is paid on its own.

-- Left nullable: a service put back from the recycle bin may be from before this column.
alter table other_cost add column on_bill boolean default false;
alter table machine_services add column on_bill boolean default false;

create function app_mark_on_bill(p_kind text, p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_done int := 0;
begin
  if coalesce(app_my_role() in ('owner', 'office'), false) is not true then
    raise exception 'you cannot settle costs';
  end if;
  if p_kind = 'cost' then
    update other_cost set on_bill = p_on where id = p_id and entry_id is null and app_has_site(site_id);
    get diagnostics v_done = row_count;
  elsif p_kind = 'service' then
    update machine_services set on_bill = p_on where id = p_id and entry_id is null;
    get diagnostics v_done = row_count;
  end if;
  if v_done = 0 then
    raise exception 'this cost is already paid or removed';
  end if;
end $$;
revoke all on function app_mark_on_bill(text, uuid, boolean) from public, anon;
grant execute on function app_mark_on_bill(text, uuid, boolean) to authenticated;

-- A service typed as not paid yet, now paid: its line is swapped for the paid one, still on the day of the service.
create function app_pay_service(p_service uuid, p_entry jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_service machine_services%rowtype;
  v_result jsonb;
begin
  if coalesce(app_my_role() in ('owner', 'office'), false) is not true then
    raise exception 'you cannot pay for machines';
  end if;
  if exists (select 1 from entries where id = (p_entry ->> 'id')::uuid and created_by = auth.uid()) then
    return jsonb_build_object('id', p_entry ->> 'id', 'duplicate', true);
  end if;
  select * into v_service from machine_services where id = p_service for update;
  if v_service.id is null or v_service.entry_id is not null then
    raise exception 'this cost is already paid or removed';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_entry -> 'lines') l
      where l ->> 'account' = 'money' and -(l ->> 'amountPaise')::bigint = v_service.cost_paise) then
    raise exception 'the entry does not pay this service';
  end if;
  delete from machine_services where id = p_service;
  v_result := app_pay(jsonb_build_array(jsonb_build_object('entry', p_entry, 'lines', jsonb_build_array(jsonb_build_object(
    'source', 'machine', 'id', v_service.machine_id, 'hours', v_service.running_hours, 'amountPaise', v_service.cost_paise, 'note', v_service.note)))));
  update machine_services set service_date = v_service.service_date where entry_id = (p_entry ->> 'id')::uuid;
  return v_result -> 0;
end $$;
revoke all on function app_pay_service(uuid, jsonb) from public, anon;
grant execute on function app_pay_service(uuid, jsonb) to authenticated;
