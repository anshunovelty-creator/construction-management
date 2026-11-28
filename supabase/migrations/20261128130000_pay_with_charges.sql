-- Bank charges on every payment from a bank (owner decision 2026-11-28): Pay salaries, Pay labour, a site cost or a
-- machine's service may carry what the bank kept on top, as a firm_cost line with head bank_charges in the same entry
-- (the bank line is the payment plus the charges). The lines paid must add up to the payment without the charges.
-- Bodies as in 20261126100000_machine_papers.sql, with only those two checks changed.

create or replace function app_pay(p_batches jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := app_assert_signed_in();
  v_batch jsonb;
  v_entry jsonb;
  v_line jsonb;
  v_source text;
  v_id uuid;
  v_sum bigint;
  v_money bigint;
  v_account money_accounts%rowtype;
  v_method text;
  v_result jsonb := '[]';
  v_posted jsonb;
begin
  for v_batch in select * from jsonb_array_elements(p_batches) loop
    v_entry := nullif(v_batch -> 'entry', 'null'::jsonb);
    v_id := (v_entry ->> 'id')::uuid;
    v_method := null;
    if jsonb_typeof(v_batch -> 'lines') is distinct from 'array' or jsonb_array_length(v_batch -> 'lines') = 0 then
      raise exception 'nothing to pay';
    end if;
    if v_entry is not null then
      -- A retry after a lost connection: the same entry, with its lines, is already there.
      if exists (select 1 from entries where id = v_id) then
        if not exists (select 1 from entries where id = v_id and created_by = auth.uid()) then
          raise exception 'entry id % is already in use', v_id;
        end if;
        v_result := v_result || jsonb_build_object('id', v_id, 'serial', (select serial from entries where id = v_id), 'duplicate', true);
        continue;
      end if;
      if v_entry ->> 'entryType' not in ('wages_paid', 'site_cash_expense', 'other_out') then
        raise exception 'this kind of entry pays no one';
      end if;
      if (select count(*) from jsonb_array_elements(v_entry -> 'lines') l where l ->> 'account' = 'money') <> 1 then
        raise exception 'a payment comes from one account';
      end if;
      select m.* into v_account from money_accounts m
        where m.id = (select (l ->> 'moneyAccountId')::uuid from jsonb_array_elements(v_entry -> 'lines') l where l ->> 'account' = 'money');
      if v_account.id is null or not v_account.is_active then
        raise exception 'choose the account it was paid from';
      end if;
      v_method := case v_account.kind when 'bank' then 'bank' else 'cash' end;
      if v_role = 'labour' then
        -- Only workers, only from the cash they hold themselves.
        if v_account.holder_user_id is distinct from auth.uid() or v_entry ->> 'entryType' <> 'wages_paid'
           or exists (select 1 from jsonb_array_elements(v_batch -> 'lines') l where l ->> 'source' <> 'labour') then
          raise exception 'you can only pay workers from your own cash';
        end if;
      else
        perform app_assert_can_post(v_entry);
      end if;
      -- Signed as the lines are: money given is a plus, money returned a minus.
      select coalesce(sum((l ->> 'amountPaise')::bigint * case l ->> 'kind' when 'returned' then -1 else 1 end), 0) into v_sum
        from jsonb_array_elements(v_batch -> 'lines') l;
      -- What the bank kept on top is the firm's bank charges, not money given to anyone (owner decision 2026-11-28).
      select -(l ->> 'amountPaise')::bigint into v_money from jsonb_array_elements(v_entry -> 'lines') l where l ->> 'account' = 'money';
      v_money := v_money - coalesce((select sum((l ->> 'amountPaise')::bigint) from jsonb_array_elements(v_entry -> 'lines') l
        where l ->> 'account' = 'firm_cost' and l ->> 'costHead' = 'bank_charges'), 0);
      if v_money <> -(select (l ->> 'amountPaise')::bigint from jsonb_array_elements(v_entry -> 'lines') l where l ->> 'account' = 'money')
         and v_account.kind <> 'bank' then
        raise exception 'bank charges come out of a bank';
      end if;
      if v_sum <> v_money then
        raise exception 'the lines add up to %, but the entry pays %', v_sum, v_money;
      end if;
      v_posted := post_entry(v_entry, auth.uid(), null);
      v_result := v_result || v_posted;
    end if;

    perform set_config('app.linking', '1', true);
    for v_line in select * from jsonb_array_elements(v_batch -> 'lines') loop
      v_source := v_line ->> 'source';
      if v_source <> 'other_cost' and v_entry is null then
        raise exception 'money given needs the account it came from';
      end if;
      if v_source in ('salary', 'labour') and (v_entry ->> 'entryType' <> 'wages_paid' or v_line ->> 'kind' not in ('advance', 'payment', 'returned')) then
        raise exception 'this kind of entry pays no one';
      end if;
      if v_source = 'salary' then
        if v_role not in ('owner', 'office') then raise exception 'you cannot pay salaries'; end if;
        insert into salary_money (party_id, money_date, kind, amount_paise, method, note, created_by, entry_id)
        values ((v_line ->> 'id')::uuid, (v_entry ->> 'entryDate')::date, v_line ->> 'kind', (v_line ->> 'amountPaise')::bigint, v_method, coalesce(v_line ->> 'note', ''), auth.uid(), v_id);
      elsif v_source = 'labour' then
        if not app_labour_access() then raise exception 'you cannot pay labour'; end if;
        if not exists (select 1 from firms where id = v_account.firm_id and runs_labour) then
          raise exception 'workers are paid from an account of the firm that runs Labour payment';
        end if;
        if not exists (select 1 from labour_workers where id = (v_line ->> 'id')::uuid and head_id = id) then
          raise exception 'a family is paid through its head';
        end if;
        insert into labour_money (worker_id, money_date, kind, amount_paise, method, note, created_by, entry_id)
        values ((v_line ->> 'id')::uuid, (v_entry ->> 'entryDate')::date, v_line ->> 'kind', (v_line ->> 'amountPaise')::bigint, v_method, coalesce(v_line ->> 'note', ''), auth.uid(), v_id);
      elsif v_source = 'other_cost' then
        if not app_has_site((v_line ->> 'siteId')::uuid) then raise exception 'you are not assigned to this site'; end if;
        if v_entry is not null and v_entry ->> 'entryType' <> 'site_cash_expense' then raise exception 'this kind of entry pays no one'; end if;
        insert into other_cost (site_id, work_date, description, cost_head, quantity, rate_paise, amount_paise, created_by, entry_id)
        values ((v_line ->> 'siteId')::uuid, (v_line ->> 'date')::date, v_line ->> 'description', (v_line ->> 'costHead')::cost_head,
          (v_line ->> 'quantity')::numeric, (v_line ->> 'ratePaise')::bigint, (v_line ->> 'amountPaise')::bigint, auth.uid(), v_id);
      elsif v_source = 'machine' then
        if v_role not in ('owner', 'office') then raise exception 'you cannot pay for machines'; end if;
        if not exists (select 1 from firms where id = v_account.firm_id and runs_labour) then
          raise exception 'a machine''s costs are paid by the firm that owns it';
        end if;
        insert into machine_services (machine_id, service_date, running_hours, cost_paise, note, created_by, entry_id,
          kind, paper_no, company, valid_from, valid_until)
        values ((v_line ->> 'id')::uuid, (v_entry ->> 'entryDate')::date, (v_line ->> 'hours')::numeric, (v_line ->> 'amountPaise')::bigint, coalesce(v_line ->> 'note', ''), auth.uid(), v_id,
          coalesce(v_line ->> 'paper', 'service'), coalesce(v_line ->> 'paperNo', ''), coalesce(v_line ->> 'company', ''),
          (v_line ->> 'validFrom')::date, (v_line ->> 'validUntil')::date);
      else
        raise exception 'unknown line';
      end if;
    end loop;
    perform set_config('app.linking', '', true);
  end loop;
  return v_result;
end $$;

-- 2. A cost typed as not paid yet, now paid: its line is swapped for the paid one, keeping the paper's details.
create or replace function app_pay_service(p_service uuid, p_entry jsonb) returns jsonb
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
      where l ->> 'account' = 'money' and -(l ->> 'amountPaise')::bigint = v_service.cost_paise + coalesce((select sum((c ->> 'amountPaise')::bigint)
        from jsonb_array_elements(p_entry -> 'lines') c where c ->> 'account' = 'firm_cost' and c ->> 'costHead' = 'bank_charges'), 0)) then
    raise exception 'the entry does not pay this service';
  end if;
  delete from machine_services where id = p_service;
  v_result := app_pay(jsonb_build_array(jsonb_build_object('entry', p_entry, 'lines', jsonb_build_array(jsonb_build_object(
    'source', 'machine', 'id', v_service.machine_id, 'hours', v_service.running_hours, 'amountPaise', v_service.cost_paise, 'note', v_service.note,
    'paper', coalesce(v_service.kind, 'service'), 'paperNo', v_service.paper_no, 'company', v_service.company,
    'validFrom', v_service.valid_from, 'validUntil', v_service.valid_until)))));
  update machine_services set service_date = v_service.service_date where entry_id = (p_entry ->> 'id')::uuid;
  return v_result -> 0;
end $$;
