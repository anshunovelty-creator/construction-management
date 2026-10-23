-- Posting functions. The app writes to the ledger only through these.

-- Indian financial year label (April to March): 2026-10-22 -> '26-27', 2027-02-01 -> '26-27'.
create function fy_label(d date) returns text
language sql immutable as $$
  select case
    when extract(month from d) >= 4
      then to_char(d, 'YY') || '-' || to_char(d + interval '1 year', 'YY')
    else to_char(d - interval '1 year', 'YY') || '-' || to_char(d, 'YY')
  end
$$;

-- Gapless: the counter row is locked until commit, and a rollback undoes the increment.
create function next_serial(p_series text, p_fy text) returns integer
language sql as $$
  insert into serial_counters (series, fy, last_seq) values (p_series, p_fy, 1)
  on conflict (series, fy) do update set last_seq = serial_counters.last_seq + 1
  returning last_seq
$$;

create function current_lock_date() returns date
language sql stable as $$
  select locked_through from books_locks order by id desc limit 1
$$;

-- Internal: inserts one entry and its lines. Callers validate the entry type first.
create function insert_entry(p_entry jsonb, p_actor uuid, p_override_reason text) returns jsonb
language plpgsql as $$
declare
  v_id uuid := (p_entry ->> 'id')::uuid;
  v_date date := (p_entry ->> 'entryDate')::date;
  v_firm uuid := nullif(p_entry ->> 'firmId', '')::uuid;
  v_lock date := current_lock_date();
  v_series text;
  v_fy text;
  v_seq integer;
  v_serial text;
  v_line jsonb;
  v_line_no integer := 0;
  v_sum bigint;
begin
  if v_id is null then
    raise exception 'entry id is required';
  end if;
  if v_date is null then
    raise exception 'entry date is required';
  end if;
  if p_actor is null then
    raise exception 'actor is required';
  end if;
  if jsonb_typeof(p_entry -> 'lines') is distinct from 'array' or jsonb_array_length(p_entry -> 'lines') < 2 then
    raise exception 'an entry needs at least two lines';
  end if;

  select coalesce(sum((l ->> 'amountPaise')::bigint), 0)::bigint into v_sum
  from jsonb_array_elements(p_entry -> 'lines') l;
  if v_sum <> 0 then
    raise exception 'entry does not balance: lines sum to % paise', v_sum;
  end if;

  if v_lock is not null and v_date <= v_lock and coalesce(btrim(p_override_reason), '') = '' then
    raise exception 'books are locked through %; a reason is required to post on %', v_lock, v_date;
  end if;

  if v_firm is null then
    v_series := 'CM';
  else
    select code into v_series from firms where id = v_firm;
    if v_series is null then
      raise exception 'unknown firm %', v_firm;
    end if;
  end if;

  v_fy := fy_label(v_date);
  v_seq := next_serial(v_series, v_fy);
  v_serial := v_series || '/' || v_fy || '/' || lpad(v_seq::text, 6, '0');

  insert into entries (
    id, serial, series, fy, seq, entry_type, entry_date, firm_id, party_id,
    reference, narration, reverses_entry_id, replaces_entry_id, created_by
  ) values (
    v_id, v_serial, v_series, v_fy, v_seq, (p_entry ->> 'entryType')::entry_type, v_date, v_firm,
    nullif(p_entry ->> 'partyId', '')::uuid,
    coalesce(p_entry ->> 'reference', ''),
    coalesce(p_entry ->> 'narration', ''),
    nullif(p_entry ->> 'reversesEntryId', '')::uuid,
    nullif(p_entry ->> 'replacesEntryId', '')::uuid,
    p_actor
  );

  for v_line in select * from jsonb_array_elements(p_entry -> 'lines') loop
    v_line_no := v_line_no + 1;
    insert into entry_lines (
      entry_id, line_no, account, amount_paise, firm_id, counter_firm_id,
      money_account_id, party_id, site_id, work_order_id, cost_head
    ) values (
      v_id, v_line_no,
      (v_line ->> 'account')::ledger_account,
      (v_line ->> 'amountPaise')::bigint,
      nullif(v_line ->> 'firmId', '')::uuid,
      nullif(v_line ->> 'counterFirmId', '')::uuid,
      nullif(v_line ->> 'moneyAccountId', '')::uuid,
      nullif(v_line ->> 'partyId', '')::uuid,
      nullif(v_line ->> 'siteId', '')::uuid,
      nullif(v_line ->> 'workOrderId', '')::uuid,
      nullif(v_line ->> 'costHead', '')::cost_head
    );
  end loop;

  if v_lock is not null and v_date <= v_lock then
    insert into entry_events (entry_id, kind, actor, reason)
    values (v_id, 'lock_override', p_actor, p_override_reason);
  end if;

  return jsonb_build_object('id', v_id, 'serial', v_serial, 'duplicate', false);
end $$;

-- Posts a new entry. Re-posting the same id returns the existing entry (safe offline retries).
create function post_entry(p_entry jsonb, p_actor uuid, p_override_reason text default null) returns jsonb
language plpgsql as $$
declare
  v_existing entries%rowtype;
begin
  select * into v_existing from entries where id = (p_entry ->> 'id')::uuid;
  if found then
    return jsonb_build_object('id', v_existing.id, 'serial', v_existing.serial, 'duplicate', true);
  end if;
  if p_entry ->> 'entryType' = 'reversal'
     or p_entry ? 'reversesEntryId' or p_entry ? 'replacesEntryId' then
    raise exception 'use reverse_entry or replace_entry to cancel or change an entry';
  end if;
  return insert_entry(p_entry, p_actor, p_override_reason);
end $$;

create function lock_books(p_through date, p_actor uuid, p_reason text default '') returns void
language plpgsql as $$
declare
  v_current date := current_lock_date();
begin
  if p_through is null then
    raise exception 'lock date is required';
  end if;
  if v_current is not null and p_through < v_current and coalesce(btrim(p_reason), '') = '' then
    raise exception 'moving the lock back from % to % needs a reason', v_current, p_through;
  end if;
  insert into books_locks (locked_through, actor, reason) values (p_through, p_actor, coalesce(p_reason, ''));
end $$;
