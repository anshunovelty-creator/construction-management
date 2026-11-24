-- 1. Lines: wages, office costs, loans, deposits and tax belong to a firm; office costs and other income also say what for.
alter table entry_lines drop constraint line_dimensions;
alter table entry_lines add constraint line_dimensions check (
  case account
    when 'money' then
      money_account_id is not null and counter_firm_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'vendor_payable' then
      firm_id is not null and party_id is not null and counter_firm_id is null
      and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
    when 'inter_firm' then
      firm_id is not null and counter_firm_id is not null and firm_id <> counter_firm_id
      and money_account_id is null and party_id is null and site_id is null
      and work_order_id is null and cost_head is null
    when 'firm_income' then
      firm_id is not null and counter_firm_id is not null and firm_id <> counter_firm_id
      and cost_head in ('labour', 'machine_hire')
      and money_account_id is null and party_id is null and site_id is null and work_order_id is null
    when 'site_cost' then
      site_id is not null and cost_head is not null and counter_firm_id is null and money_account_id is null
    when 'owner_capital' then
      counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'opening_balance' then
      counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'cash_short_excess' then
      counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'firm_cost' then
      firm_id is not null and cost_head is not null and counter_firm_id is null and money_account_id is null
      and party_id is null and site_id is null and work_order_id is null
    when 'other_income' then
      firm_id is not null and cost_head is not null and counter_firm_id is null and money_account_id is null
      and party_id is null and site_id is null and work_order_id is null
    when 'wages_paid' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'loan' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'deposit_given' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'gst_paid' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'tds_paid' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'pf_paid' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'tds_claimed' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'not_yet_known' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'contract_income' then
      firm_id is not null and party_id is not null and site_id is not null
      and counter_firm_id is null and money_account_id is null and cost_head is null
    when 'tds_claimable' then
      firm_id is not null and (party_id is null) <> (counter_firm_id is null)
      and money_account_id is null and cost_head is null
    -- client_receivable, retention_held, security_deposit_held, company_assets: the site is optional
    when 'client_receivable' then
      firm_id is not null and party_id is not null and counter_firm_id is null and money_account_id is null and cost_head is null
    when 'retention_held' then
      firm_id is not null and party_id is not null and counter_firm_id is null and money_account_id is null and cost_head is null
    when 'security_deposit_held' then
      firm_id is not null and party_id is not null and counter_firm_id is null and money_account_id is null and cost_head is null
    when 'company_assets' then
      firm_id is not null and party_id is not null and counter_firm_id is null and money_account_id is null and cost_head is null
    -- gst_input, gst_output, tds_payable
    else
      firm_id is not null and (party_id is null) <> (counter_firm_id is null)
      and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
  end
);

-- 2. Money lines kept outside the ledger (salary, labour payment, daily-report costs, machine service) name the entry
-- that moved the money. Money given can only be kept together with its entry, through app_pay; a deduction moves none.
alter table salary_money add column entry_id uuid references entries (id);
alter table labour_money add column entry_id uuid references entries (id);
alter table other_cost add column entry_id uuid references entries (id);
alter table machine_services add column entry_id uuid references entries (id);
create index salary_money_entry on salary_money (entry_id) where entry_id is not null;
create index labour_money_entry on labour_money (entry_id) where entry_id is not null;
create index other_cost_entry on other_cost (entry_id) where entry_id is not null;
create index machine_services_entry on machine_services (entry_id) where entry_id is not null;

-- Money handed back by someone who was given too much.
alter table salary_money drop constraint salary_money_kind_check;
alter table salary_money add constraint salary_money_kind_check check (kind in ('advance', 'payment', 'deduction', 'returned'));
alter table labour_money drop constraint labour_money_kind_check;
alter table labour_money add constraint labour_money_kind_check check (kind in ('advance', 'payment', 'deduction', 'returned'));

drop policy salary_money_add on salary_money;
create policy salary_money_add on salary_money for insert to authenticated
  with check (app_my_role() in ('owner', 'office') and created_by = auth.uid() and kind = 'deduction');
drop policy labour_money_add on labour_money;
create policy labour_money_add on labour_money for insert to authenticated
  with check (app_labour_access() and created_by = auth.uid() and kind = 'deduction');

create function money_line_link() returns trigger
language plpgsql as $$
begin
  if new.entry_id is not null and coalesce(current_setting('app.linking', true), '') <> '1' then
    raise exception 'a line is tied to its entry only when the money is paid';
  end if;
  return new;
end $$;
create trigger salary_money_link before insert or update of entry_id on salary_money for each row execute function money_line_link();
create trigger labour_money_link before insert or update of entry_id on labour_money for each row execute function money_line_link();
create trigger other_cost_link before insert or update of entry_id on other_cost for each row execute function money_line_link();
create trigger machine_services_link before insert or update of entry_id on machine_services for each row execute function money_line_link();

-- The monthly sheet's Paid and Advance boxes had no date and no account: what is there stays, and no more is typed there.
create function labour_months_no_money() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and (new.paid_paise, new.advance_paise) is distinct from
     (case when tg_op = 'UPDATE' then (old.paid_paise, old.advance_paise) else (0::bigint, 0::bigint) end) then
    raise exception 'money given is kept on the Pay page, with its date and the account it came from';
  end if;
  return new;
end $$;
create trigger labour_months_no_money before insert or update on labour_months
  for each row execute function labour_months_no_money();

create function entry_is_live(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from entry_status where entry_id = p_id and status in ('verified', 'unverified'))
$$;

create function linked_lines(p_entry uuid) returns integer
language sql stable security definer set search_path = public as $$
  select ((select count(*) from salary_money where entry_id = p_entry) + (select count(*) from labour_money where entry_id = p_entry)
    + (select count(*) from other_cost where entry_id = p_entry) + (select count(*) from machine_services where entry_id = p_entry))::integer
$$;

-- Taking a line off puts its money back, by cancelling its entry. A line paid together with others goes only with them.
create function money_line_removed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.entry_id is not null and entry_is_live(old.entry_id) then
    if linked_lines(old.entry_id) > 1 then
      raise exception 'this was paid together with others in entry %: cancel that entry instead', (select serial from entries where id = old.entry_id);
    end if;
    perform set_config('app.removing', '1', true);
    perform reverse_entry(old.entry_id, coalesce(auth.uid(), (select created_by from entries where id = old.entry_id)), 'Line removed');
    perform set_config('app.removing', '', true);
  end if;
  return old;
end $$;
create trigger salary_money_removed before delete on salary_money for each row execute function money_line_removed();
create trigger labour_money_removed before delete on labour_money for each row execute function money_line_removed();
create trigger other_cost_removed before delete on other_cost for each row execute function money_line_removed();
create trigger machine_services_removed before delete on machine_services for each row execute function money_line_removed();

-- And cancelling the entry takes its lines off (the change log keeps them).
create function entry_cancelled_lines() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('rejected', 'reversed', 'replaced') and coalesce(current_setting('app.removing', true), '') <> '1' then
    delete from salary_money where entry_id = new.entry_id;
    delete from labour_money where entry_id = new.entry_id;
    delete from other_cost where entry_id = new.entry_id;
    delete from machine_services where entry_id = new.entry_id;
  end if;
  return null;
end $$;
create trigger entry_cancelled_lines after insert on entry_events for each row execute function entry_cancelled_lines();

-- 3. A Labour login may hold cash of the firm that runs Labour payment, and sees what goes in and out of it.
create or replace function app_can_see_entry(p_entry_id uuid) returns boolean
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
    when 'labour' then exists (
      select 1 from entry_lines l
      join money_accounts m on m.id = l.money_account_id
      where l.entry_id = p_entry_id and m.holder_user_id = auth.uid()
    )
    else false
  end
$$;

create or replace function app_assert_can_post(p_entry jsonb) returns void
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
    if v_type not in ('vendor_bill', 'vendor_payment', 'client_bill', 'client_receipt', 'cash_transfer', 'not_yet_known',
                      'firm_transfer', 'labour_supplied', 'machine_rent', 'wages_paid', 'other_in', 'other_out',
                      'site_cash_expense') then
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

  if v_role <> 'supervisor' then
    raise exception 'you cannot post entries';
  end if;

  if v_type not in ('site_cash_expense', 'cash_close_difference') then
    raise exception 'supervisors cannot post % entries', v_type;
  end if;
  for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
    if v_line ->> 'account' not in ('money', 'site_cost', 'cash_short_excess') then
      raise exception 'supervisor entries can only use your cash and site costs';
    end if;
    if v_line ->> 'account' = 'money' and not exists (
      select 1 from money_accounts
      where id = nullif(v_line ->> 'moneyAccountId', '')::uuid
        and kind = 'supervisor_cash' and holder_user_id = auth.uid()
    ) then
      raise exception 'supervisors can only spend from their own cash';
    end if;
    if nullif(v_line ->> 'firmId', '') is not null and not exists (
      select 1 from money_accounts
      where firm_id = (v_line ->> 'firmId')::uuid and kind = 'supervisor_cash' and holder_user_id = auth.uid()
    ) then
      raise exception 'supervisor entries can only use the firm of your own cash';
    end if;
    if nullif(v_line ->> 'siteId', '') is not null and not app_has_site((v_line ->> 'siteId')::uuid) then
      raise exception 'you are not assigned to this site';
    end if;
  end loop;
end $$;

-- 4. Pays people and costs: each batch is one entry with the lines it pays, saved together or not at all. A batch with no
-- entry keeps daily-report costs not paid yet.
--   [{"entry": {...} | null, "lines": [{"source": "salary" | "labour" | "other_cost" | "machine", ...}]}]
create function app_pay(p_batches jsonb) returns jsonb
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
      select -(l ->> 'amountPaise')::bigint into v_money from jsonb_array_elements(v_entry -> 'lines') l where l ->> 'account' = 'money';
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
          raise exception 'a machine''s service is paid by the firm that owns it';
        end if;
        insert into machine_services (machine_id, service_date, running_hours, cost_paise, note, created_by, entry_id)
        values ((v_line ->> 'id')::uuid, (v_entry ->> 'entryDate')::date, (v_line ->> 'hours')::numeric, (v_line ->> 'amountPaise')::bigint, coalesce(v_line ->> 'note', ''), auth.uid(), v_id);
      else
        raise exception 'unknown line';
      end if;
    end loop;
    perform set_config('app.linking', '', true);
  end loop;
  return v_result;
end $$;
grant execute on function app_pay(jsonb) to authenticated;

-- 5. Views. Why each bankbook line moved: the other account of its entry, and what for.
create or replace view money_rows with (security_invoker = true) as
with rows as (
  select
    l.money_account_id, l.firm_id, l.entry_id, sum(l.amount_paise)::bigint as amount_paise
  from entry_lines l
  where l.account = 'money'
  group by l.money_account_id, l.firm_id, l.entry_id
)
select
  r.money_account_id, r.firm_id, r.entry_id, e.serial, e.entry_type, e.entry_date, e.party_id, e.reference, e.narration,
  r.amount_paise,
  (sum(r.amount_paise) over w)::bigint as balance_paise,
  row_number() over w as position,
  e.created_at,
  (select o.money_account_id from entry_lines o
   where o.entry_id = r.entry_id and o.account = 'money' and o.money_account_id <> r.money_account_id limit 1) as other_account_id,
  (select c.site_id from entry_lines c where c.entry_id = r.entry_id and c.account = 'site_cost' order by c.line_no limit 1) as site_id,
  (select o.counter_firm_id from entry_lines o
   where o.entry_id = r.entry_id and o.account = 'inter_firm' and o.firm_id = r.firm_id limit 1) as counter_firm_id,
  (select o.account || coalesce('_' || o.cost_head, '') from entry_lines o
   where o.entry_id = r.entry_id and o.account not in ('money', 'inter_firm') order by o.line_no limit 1) as reason
from rows r
join money_accounts a on a.id = r.money_account_id
join entries e on e.id = r.entry_id
join entry_status s on s.entry_id = e.id
where s.status in ('verified', 'unverified') and r.amount_paise <> 0
window w as (partition by r.money_account_id order by e.entry_date, (e.entry_type <> 'opening'), e.created_at, r.entry_id);

create or replace view money_flow with (security_invoker = true) as
select
  firm_id, to_char(entry_date, 'YYYY-MM') as month, entry_type, counter_firm_id is not null as between_firms,
  coalesce(sum(amount_paise) filter (where amount_paise > 0), 0)::bigint as in_paise,
  coalesce(-sum(amount_paise) filter (where amount_paise < 0), 0)::bigint as out_paise,
  case when entry_type in ('other_in', 'other_out') then reason end as reason
from money_rows
where firm_id is not null
group by 1, 2, 3, 4, 7;

-- Tax paid to the government or got back, with the month it is for (the entry's reference).
create view tax_rows with (security_invoker = true) as
select l.firm_id, l.account, e.id as entry_id, e.serial, e.entry_date, e.reference as month, sum(l.amount_paise)::bigint as amount_paise
from entry_lines l
join entries e on e.id = l.entry_id
join entry_status s on s.entry_id = e.id
where l.account in ('gst_paid', 'tds_paid', 'pf_paid', 'tds_claimed') and s.status in ('verified', 'unverified')
group by l.firm_id, l.account, e.id;
grant select on tax_rows to authenticated;
