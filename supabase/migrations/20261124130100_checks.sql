-- See docs/superpowers/specs/2026-11-24-bank-cash-stage4-design.md.
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
    when 'round_off' then
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

-- 1. Bank matching. A tick says the bank has the line, and on which day: a cheque given waits until then. Not a ledger
-- row: it can be taken off again, and the change log keeps it.
create table bank_ticks (
  entry_id uuid not null references entries (id),
  money_account_id uuid not null references money_accounts (id),
  cleared_on date not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (entry_id, money_account_id)
);
create function bank_ticks_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from entry_lines l join money_accounts m on m.id = l.money_account_id
    where l.entry_id = new.entry_id and m.id = new.money_account_id and m.kind = 'bank'
  ) or not entry_is_live(new.entry_id) then
    raise exception 'only a line of a bank''s bankbook can be ticked';
  end if;
  return new;
end $$;
create trigger bank_ticks_check before insert or update on bank_ticks for each row execute function bank_ticks_check();
create trigger bank_ticks_audit after insert or update or delete on bank_ticks
  for each row execute function log_master_change('entry_id');

-- The balance on a bank statement, on its date.
create table bank_statements (
  money_account_id uuid not null references money_accounts (id),
  statement_date date not null,
  balance_paise bigint not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (money_account_id, statement_date)
);
create trigger bank_statements_audit after insert or update or delete on bank_statements
  for each row execute function log_master_change('money_account_id');

create function app_keeps_account(p_account uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from money_accounts where id = p_account and firm_id is not null and app_my_role() in ('owner', 'office') and app_has_firm(firm_id))
$$;
grant execute on function app_keeps_account(uuid) to authenticated;

alter table bank_ticks enable row level security;
create policy bank_ticks_all on bank_ticks for all to authenticated
  using (app_keeps_account(money_account_id)) with check (app_keeps_account(money_account_id));
grant select, insert, update, delete on bank_ticks to authenticated;
alter table bank_statements enable row level security;
create policy bank_statements_all on bank_statements for all to authenticated
  using (app_keeps_account(money_account_id)) with check (app_keeps_account(money_account_id));
grant select, insert, update, delete on bank_statements to authenticated;

-- The bank has it, so it happened: it is unticked before it can be cancelled or replaced.
create function entry_events_ticked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('rejected', 'reversed', 'replaced') and exists (select 1 from bank_ticks where entry_id = new.entry_id) then
    raise exception 'entry % is matched with the bank: untick it on the bank''s Match page first', (select serial from entries where id = new.entry_id);
  end if;
  return new;
end $$;
create trigger entry_events_ticked before insert on entry_events for each row execute function entry_events_ticked();

-- 2. Views: a bankbook line says when the bank had it; a statement is compared afresh each time it is read, so an entry
-- changed afterwards shows.
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
   where o.entry_id = r.entry_id and o.account not in ('money', 'inter_firm') order by o.line_no limit 1) as reason,
  (select t.cleared_on from bank_ticks t where t.entry_id = r.entry_id and t.money_account_id = r.money_account_id) as cleared_on
from rows r
join money_accounts a on a.id = r.money_account_id
join entries e on e.id = r.entry_id
join entry_status s on s.entry_id = e.id
where s.status in ('verified', 'unverified') and r.amount_paise <> 0
window w as (partition by r.money_account_id order by e.entry_date, (e.entry_type <> 'opening'), e.created_at, r.entry_id);

create view bank_match with (security_invoker = true) as
select
  s.money_account_id, s.statement_date, s.balance_paise,
  (select coalesce(sum(m.amount_paise), 0) from money_rows m
   where m.money_account_id = s.money_account_id
     and ((m.entry_type = 'opening' and m.entry_date <= s.statement_date) or m.cleared_on <= s.statement_date))::bigint as expected_paise
from bank_statements s;
grant select on bank_match to authenticated;

-- Each firm's books on their own: always zero. Lines from before firms were on every line take their entry's firm.
create view firm_proof with (security_invoker = true) as
select coalesce(l.firm_id, e.firm_id) as firm_id, sum(l.amount_paise)::bigint as total_paise
from entry_lines l join entries e on e.id = l.entry_id
group by 1;
grant select on firm_proof to authenticated;

-- 3. Cash counts. The count is compared with what the books say at the end of that day, and a difference is put right
-- by an entry of its own.
create table cash_counts (
  id uuid primary key,
  money_account_id uuid not null references money_accounts (id),
  count_date date not null,
  counted_paise bigint not null check (counted_paise >= 0),
  expected_paise bigint not null,
  entry_id uuid references entries (id),
  note text not null default '',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index cash_counts_account on cash_counts (money_account_id, count_date, created_at);
create trigger cash_counts_append_only before update or delete on cash_counts for each row execute function reject_change();
alter table cash_counts enable row level security;
create policy cash_counts_read on cash_counts for select to authenticated using (
  app_keeps_account(money_account_id)
  or exists (select 1 from money_accounts where id = money_account_id and holder_user_id = auth.uid())
);
grant select on cash_counts to authenticated;

create function app_count_cash(p_id uuid, p_account uuid, p_date date, p_counted bigint, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_account money_accounts%rowtype;
  v_expected bigint;
  v_difference bigint;
  v_entry uuid;
  v_old cash_counts%rowtype;
begin
  perform app_assert_signed_in();
  select * into v_old from cash_counts where id = p_id;
  if found then
    if v_old.created_by <> auth.uid() then raise exception 'count id % is already in use', p_id; end if;
    return jsonb_build_object('expected', v_old.expected_paise, 'difference', v_old.counted_paise - v_old.expected_paise);
  end if;
  select * into v_account from money_accounts where id = p_account for update;
  if v_account.id is null or not (app_keeps_account(p_account) or v_account.holder_user_id is not distinct from auth.uid()) then
    raise exception 'you cannot count this cash';
  end if;
  if v_account.kind = 'bank' or v_account.firm_id is null then
    raise exception 'only a cash account is counted';
  end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date or p_counted is null or p_counted < 0 then
    raise exception 'give the cash counted, on a day up to today';
  end if;
  if current_lock_date() is not null and p_date <= current_lock_date() then
    raise exception 'books are locked through %', current_lock_date();
  end if;
  select coalesce(sum(l.amount_paise), 0) into v_expected
  from entry_lines l join entries e on e.id = l.entry_id join entry_status s on s.entry_id = e.id
  where l.money_account_id = p_account and e.entry_date <= p_date and s.status in ('verified', 'unverified');
  v_difference := p_counted - v_expected;
  if v_difference <> 0 then
    v_entry := gen_random_uuid();
    perform post_entry(jsonb_build_object(
      'id', v_entry, 'entryType', 'cash_close_difference', 'entryDate', p_date, 'firmId', v_account.firm_id,
      'narration', case when v_difference < 0 then 'Cash short when counted' else 'Cash extra when counted' end
        || case when btrim(coalesce(p_note, '')) = '' then '' else ' · ' || btrim(p_note) end,
      'lines', jsonb_build_array(
        jsonb_build_object('account', 'money', 'amountPaise', v_difference, 'firmId', v_account.firm_id, 'moneyAccountId', p_account),
        jsonb_build_object('account', 'cash_short_excess', 'amountPaise', -v_difference, 'firmId', v_account.firm_id))
    ), auth.uid(), null);
  end if;
  insert into cash_counts (id, money_account_id, count_date, counted_paise, expected_paise, entry_id, note, created_by)
  values (p_id, p_account, p_date, p_counted, v_expected, v_entry, coalesce(btrim(p_note), ''), auth.uid());
  return jsonb_build_object('expected', v_expected, 'difference', v_difference);
end $$;
grant execute on function app_count_cash(uuid, uuid, date, bigint, text) to authenticated;
