-- What the app calls. Each function checks the signed-in user's role and assignments,
-- then calls the Plan 1 ledger function with auth.uid() as the actor.

-- Office: entries of their firms, and common (firm-less) entries. Supervisor: entries they made
-- and entries that touch their own cash. Supervisors never see client income or other sites' costs.
create function app_can_see_entry(p_entry_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case app_my_role()
    when 'owner' then true
    when 'office' then exists (
      select 1 from entries e
      where e.id = p_entry_id
        and (
          e.firm_id is null
          or app_has_firm(e.firm_id)
          or exists (
            select 1 from entry_lines l
            where l.entry_id = e.id and (app_has_firm(l.firm_id) or app_has_firm(l.counter_firm_id))
          )
        )
    )
    when 'supervisor' then exists (
      select 1 from entries e
      where e.id = p_entry_id
        and (
          e.created_by = auth.uid()
          or exists (
            select 1 from entry_lines l
            join money_accounts m on m.id = l.money_account_id
            where l.entry_id = e.id and m.holder_user_id = auth.uid()
          )
        )
    )
    else false
  end
$$;

create function app_assert_signed_in() returns app_role
language plpgsql stable security definer set search_path = public as $$
declare
  v_role app_role := app_my_role();
begin
  if v_role is null then
    raise exception 'not signed in, or this account is deactivated';
  end if;
  return v_role;
end $$;

create function app_assert_can_post(p_entry jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_role app_role := app_assert_signed_in();
  v_type text := p_entry ->> 'entryType';
  v_lock date := current_lock_date();
  v_line jsonb;
begin
  if v_role = 'owner' then
    return;
  end if;
  if v_lock is not null and (p_entry ->> 'entryDate')::date <= v_lock then
    raise exception 'books are locked through %; only the owner can post on or before that date', v_lock;
  end if;

  if v_role = 'office' then
    if v_type not in ('vendor_bill', 'vendor_payment', 'client_bill', 'client_receipt', 'cash_transfer') then
      raise exception 'office staff cannot post % entries', v_type;
    end if;
    if nullif(p_entry ->> 'firmId', '') is not null and not app_has_firm((p_entry ->> 'firmId')::uuid) then
      raise exception 'you are not assigned to every firm in this entry';
    end if;
    for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
      if (nullif(v_line ->> 'firmId', '') is not null and not app_has_firm((v_line ->> 'firmId')::uuid))
         or (nullif(v_line ->> 'counterFirmId', '') is not null
             and not app_has_firm((v_line ->> 'counterFirmId')::uuid)) then
        raise exception 'you are not assigned to every firm in this entry';
      end if;
    end loop;
    return;
  end if;

  -- Supervisor: only site spends and day-close differences, only from their own cash, only at their sites.
  if v_type not in ('site_cash_expense', 'cash_close_difference') then
    raise exception 'supervisors cannot post % entries', v_type;
  end if;
  for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
    if v_line ->> 'account' not in ('money', 'site_cost', 'cash_short_excess')
       or nullif(v_line ->> 'firmId', '') is not null then
      raise exception 'supervisor entries can only use your cash and site costs';
    end if;
    if v_line ->> 'account' = 'money' and not exists (
      select 1 from money_accounts
      where id = nullif(v_line ->> 'moneyAccountId', '')::uuid
        and kind = 'supervisor_cash' and holder_user_id = auth.uid()
    ) then
      raise exception 'supervisors can only spend from their own cash';
    end if;
    if nullif(v_line ->> 'siteId', '') is not null and not app_has_site((v_line ->> 'siteId')::uuid) then
      raise exception 'you are not assigned to this site';
    end if;
  end loop;
end $$;

-- Only the owner changes verified entries or entries in locked books (spec section 4, rule 6).
-- Others may cancel unverified entries they made, and office staff those of their firms.
create function app_assert_can_cancel(p_entry_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_role app_role := app_assert_signed_in();
  v_entry entries%rowtype;
  v_lock date := current_lock_date();
begin
  select * into v_entry from entries where id = p_entry_id;
  if not found or not app_can_see_entry(p_entry_id) then
    raise exception 'entry % not found', p_entry_id;
  end if;
  if v_role = 'owner' then
    return;
  end if;
  if exists (select 1 from entry_events where entry_id = p_entry_id and kind = 'verified') then
    raise exception 'entry % is verified; only the owner can change it', v_entry.serial;
  end if;
  if v_lock is not null and v_entry.entry_date <= v_lock then
    raise exception 'entry % is in locked books; only the owner can change it', v_entry.serial;
  end if;
  if v_entry.created_by <> auth.uid() and v_role <> 'office' then
    raise exception 'you cannot change entry %', v_entry.serial;
  end if;
end $$;

create function app_assert_can_review(p_entry_id uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_role app_role := app_assert_signed_in();
begin
  if v_role = 'supervisor' then
    raise exception 'supervisors cannot verify or reject entries';
  end if;
  if not app_can_see_entry(p_entry_id) then
    raise exception 'entry % not found', p_entry_id;
  end if;
end $$;

-- Re-sending an entry the same user already posted returns it unchanged (offline retries),
-- even if the books were locked in between.
create function app_post_entry(p_entry jsonb, p_override_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing entries%rowtype;
begin
  perform app_assert_signed_in();
  select * into v_existing from entries where id = (p_entry ->> 'id')::uuid;
  if found then
    if v_existing.created_by <> auth.uid() then
      raise exception 'entry id % is already in use', v_existing.id;
    end if;
    return jsonb_build_object('id', v_existing.id, 'serial', v_existing.serial, 'duplicate', true);
  end if;
  perform app_assert_can_post(p_entry);
  return post_entry(p_entry, auth.uid(), p_override_reason);
end $$;

create function app_verify_entry(p_entry_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform app_assert_can_review(p_entry_id);
  perform verify_entry(p_entry_id, auth.uid());
end $$;

create function app_reject_entry(p_entry_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform app_assert_can_review(p_entry_id);
  return reject_entry(p_entry_id, auth.uid(), p_reason);
end $$;

create function app_reverse_entry(p_entry_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform app_assert_can_cancel(p_entry_id);
  return reverse_entry(p_entry_id, auth.uid(), p_reason);
end $$;

create function app_replace_entry(p_old_id uuid, p_new jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform app_assert_can_cancel(p_old_id);
  perform app_assert_can_post(p_new);
  return replace_entry(p_old_id, p_new, auth.uid(), p_reason);
end $$;

create function app_lock_books(p_through date, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_owner() then
    raise exception 'only the owner can lock the books';
  end if;
  perform lock_books(p_through, auth.uid(), p_reason);
end $$;
