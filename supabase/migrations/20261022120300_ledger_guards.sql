-- Database-level guarantees. These hold even if application code has a bug.

-- 1. Ledger history can never be changed or removed.
create function reject_change() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, lower(tg_op);
end $$;

create trigger entries_append_only before update or delete on entries
  for each row execute function reject_change();
create trigger entries_no_truncate before truncate on entries
  for each statement execute function reject_change();
create trigger entry_lines_append_only before update or delete on entry_lines
  for each row execute function reject_change();
create trigger entry_lines_no_truncate before truncate on entry_lines
  for each statement execute function reject_change();
create trigger entry_events_append_only before update or delete on entry_events
  for each row execute function reject_change();
create trigger entry_events_no_truncate before truncate on entry_events
  for each statement execute function reject_change();
create trigger books_locks_append_only before update or delete on books_locks
  for each row execute function reject_change();
create trigger books_locks_no_truncate before truncate on books_locks
  for each statement execute function reject_change();

-- 2. Lines are checked against the entry and the masters they point to.
create function entry_lines_check() returns trigger
language plpgsql as $$
declare
  v_created_txid bigint;
  v_wo work_orders%rowtype;
begin
  select created_txid into v_created_txid from entries where id = new.entry_id;
  if v_created_txid is distinct from txid_current() then
    raise exception 'lines can only be added in the transaction that creates entry %', new.entry_id;
  end if;

  if new.account = 'money'
     and new.firm_id is distinct from (select firm_id from money_accounts where id = new.money_account_id) then
    raise exception 'money line firm must match the firm of money account %', new.money_account_id;
  end if;

  if new.work_order_id is not null then
    select * into v_wo from work_orders where id = new.work_order_id;
    if new.firm_id is distinct from v_wo.firm_id
       or new.site_id is distinct from v_wo.site_id
       or (new.account <> 'site_cost' and new.party_id is distinct from v_wo.client_id) then
      raise exception 'line does not match work order % (firm, site and client must agree)', new.work_order_id;
    end if;
  end if;

  return new;
end $$;

create trigger entry_lines_check before insert on entry_lines
  for each row execute function entry_lines_check();

-- 3. At commit, every entry must have at least two lines that sum to zero.
create function entries_check_balanced() returns trigger
language plpgsql as $$
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
  return null;
end $$;

create constraint trigger entries_balanced after insert on entries
  deferrable initially deferred
  for each row execute function entries_check_balanced();
