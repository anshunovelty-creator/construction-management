-- Bank and cash, stage 1 (owner decisions 2026-11-24): every bank account, cash box and cash with a person belongs to
-- one firm and has a bankbook. See docs/superpowers/specs/2026-11-24-bank-cash-stage1-design.md.

-- 1. Accounts. Shared cash made before this can only be switched off ("not valid" leaves those rows alone).
alter table money_accounts drop constraint money_accounts_check;
alter table money_accounts add constraint money_accounts_check check (firm_id is not null or not is_active) not valid;

-- An account's history belongs to its firm, and a cash account's rules to its kind: both stay once it is used.
create function money_accounts_fixed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.firm_id is distinct from old.firm_id or new.kind is distinct from old.kind)
     and exists (select 1 from entry_lines where money_account_id = old.id) then
    raise exception 'the firm and kind of "%" cannot change: it has entries', old.name;
  end if;
  return new;
end $$;
create trigger money_accounts_fixed before update on money_accounts
  for each row execute function money_accounts_fixed();

-- 2. Lines of money not yet known: only the firm whose account it is.
alter table entry_lines drop constraint line_dimensions;
alter table entry_lines add constraint line_dimensions check (
  case account
    when 'money' then
      money_account_id is not null and counter_firm_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'vendor_payable' then
      firm_id is not null and party_id is not null and counter_firm_id is null
      and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
    when 'gst_input' then
      firm_id is not null and party_id is not null and counter_firm_id is null
      and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
    when 'gst_output' then
      firm_id is not null and party_id is not null and counter_firm_id is null
      and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
    when 'tds_payable' then
      firm_id is not null and party_id is not null and counter_firm_id is null
      and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
    when 'inter_firm' then
      firm_id is not null and counter_firm_id is not null and firm_id <> counter_firm_id
      and money_account_id is null and party_id is null and site_id is null
      and work_order_id is null and cost_head is null
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
    when 'not_yet_known' then
      firm_id is not null and counter_firm_id is null and money_account_id is null and party_id is null
      and site_id is null and work_order_id is null and cost_head is null
    when 'contract_income' then
      firm_id is not null and party_id is not null and site_id is not null
      and counter_firm_id is null and money_account_id is null and cost_head is null
    -- client_receivable, retention_held, security_deposit_held, tds_claimable, company_assets: the site is optional
    else
      firm_id is not null and party_id is not null
      and counter_firm_id is null and money_account_id is null and cost_head is null
  end
);

-- 3. At commit, every entry balances, and so does each firm in it. Reversals copy an older entry's lines exactly, and
-- entries made before this may have lines without a firm, so they are only checked as a whole.
create or replace function entries_check_balanced() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_sum bigint;
begin
  select count(*), coalesce(sum(amount_paise), 0)::bigint into v_count, v_sum
  from entry_lines where entry_id = new.id;
  if v_count < 2 then
    raise exception 'entry % needs at least two lines (has %)', new.serial, v_count;
  end if;
  if v_sum <> 0 then
    raise exception 'entry % does not balance: lines sum to % paise', new.serial, v_sum;
  end if;
  if new.entry_type <> 'reversal' then
    if exists (select 1 from entry_lines where entry_id = new.id and firm_id is null) then
      raise exception 'entry % has a line with no firm', new.serial;
    end if;
    if exists (select 1 from entry_lines where entry_id = new.id group by firm_id having sum(amount_paise) <> 0) then
      raise exception 'entry % does not balance within each firm', new.serial;
    end if;
  end if;
  return null;
end $$;

-- 4. At commit, each bank or cash account the entry touches: one opening at most, nothing dated before it, and cash
-- never below zero at the end of any day. Run at commit, so that replacing an entry is judged as one step. Cancelling
-- is never refused, or a wrong receipt could not be taken out.
create function entries_check_money() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_account record;
  v_openings integer;
  v_opened date;
  v_early date;
  v_below date;
  v_from date;
begin
  if new.entry_type = 'reversal' then
    return null;
  end if;
  for v_account in
    select m.id, m.kind, m.name, sum(l.amount_paise) as net
    from entry_lines l join money_accounts m on m.id = l.money_account_id
    where l.entry_id = new.id
    group by m.id order by m.id
  loop
    -- Two payments at once cannot both pass: the second waits here, then counts the first.
    perform 1 from money_accounts where id = v_account.id for update;

    select count(distinct e.id), min(e.entry_date) into v_openings, v_opened
    from entry_lines l join entries e on e.id = l.entry_id join entry_status s on s.entry_id = e.id
    where l.money_account_id = v_account.id and e.entry_type = 'opening' and s.status in ('verified', 'unverified');
    if v_openings > 1 then
      raise exception '"%" already has an opening balance', v_account.name;
    end if;
    if v_opened is not null then
      select min(e.entry_date) into v_early
      from entry_lines l join entries e on e.id = l.entry_id join entry_status s on s.entry_id = e.id
      where l.money_account_id = v_account.id and e.entry_date < v_opened and s.status in ('verified', 'unverified');
      if v_early is not null then
        raise exception '"%" opens on %, and nothing can be dated before that (an entry is dated %)',
          v_account.name, to_char(v_opened, 'FMDD Mon YYYY'), to_char(v_early, 'FMDD Mon YYYY');
      end if;
    end if;

    if v_account.kind <> 'bank' and (v_account.net < 0 or new.replaces_entry_id is not null) then
      v_from := least(new.entry_date, (select entry_date from entries where id = new.replaces_entry_id));
      select min(d.entry_date) into v_below
      from (
        select e.entry_date, sum(sum(l.amount_paise)) over (order by e.entry_date) as balance
        from entry_lines l join entries e on e.id = l.entry_id join entry_status s on s.entry_id = e.id
        where l.money_account_id = v_account.id and s.status in ('verified', 'unverified')
        group by e.entry_date
      ) d
      where d.entry_date >= v_from and d.balance < 0;
      if v_below is not null then
        raise exception 'not enough cash: "%" would go below zero on %', v_account.name, to_char(v_below, 'FMDD Mon YYYY');
      end if;
    end if;
  end loop;
  return null;
end $$;

create constraint trigger entries_money after insert on entries
  deferrable initially deferred
  for each row execute function entries_check_money();

-- 5. Office staff may write down money not yet known; a supervisor's entries may name the firm of their own cash.
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
    if v_type not in ('vendor_bill', 'vendor_payment', 'client_bill', 'client_receipt', 'cash_transfer', 'not_yet_known') then
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

  -- A Labour login has no part in the firms' money.
  if v_role <> 'supervisor' then
    raise exception 'you cannot post entries';
  end if;

  -- Supervisor: only site spends and day-close differences, only from their own cash, only at their sites.
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

-- 6. The bankbooks: one row per live entry and account, with the balance after it. An opening comes first on its day.
-- ponytail: adds up the account's whole history on each read; keep monthly balances if one ever holds 100,000 rows.
create view money_rows with (security_invoker = true) as
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
  -- The other side of a move between accounts.
  (select o.money_account_id from entry_lines o
   where o.entry_id = r.entry_id and o.account = 'money' and o.money_account_id <> r.money_account_id limit 1) as other_account_id,
  (select c.site_id from entry_lines c where c.entry_id = r.entry_id and c.account = 'site_cost' order by c.line_no limit 1) as site_id
from rows r
-- Only accounts the person may see: a supervisor given cash sees that move, but not the bank it came from.
join money_accounts a on a.id = r.money_account_id
join entries e on e.id = r.entry_id
join entry_status s on s.entry_id = e.id
where s.status in ('verified', 'unverified') and r.amount_paise <> 0
window w as (partition by r.money_account_id order by e.entry_date, (e.entry_type <> 'opening'), e.created_at, r.entry_id);

grant select on money_rows to authenticated;
