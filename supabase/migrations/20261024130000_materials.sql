-- Materials: a list the office keeps (cement, sand, steel...), picked on a bill so it is
-- easy to see what each bill was for. Optional on an entry; set once, like the rest of an entry.

create table materials (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create trigger materials_audit after insert or update or delete on materials
  for each row execute function log_master_change('id');

-- Like parties: everyone reads, owner and office staff add and edit.
alter table materials enable row level security;
create policy materials_read on materials for select to authenticated using (app_my_role() is not null);
create policy materials_write on materials for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));
grant select, insert, update on materials to authenticated;

alter table entries add column material_id uuid references materials (id);

-- Same as before, now also storing the entry's materialId.
create or replace function insert_entry(p_entry jsonb, p_actor uuid, p_override_reason text) returns jsonb
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
    reference, narration, reverses_entry_id, replaces_entry_id, created_by, material_id
  ) values (
    v_id, v_serial, v_series, v_fy, v_seq, (p_entry ->> 'entryType')::entry_type, v_date, v_firm,
    nullif(p_entry ->> 'partyId', '')::uuid,
    coalesce(p_entry ->> 'reference', ''),
    coalesce(p_entry ->> 'narration', ''),
    nullif(p_entry ->> 'reversesEntryId', '')::uuid,
    nullif(p_entry ->> 'replacesEntryId', '')::uuid,
    p_actor,
    nullif(p_entry ->> 'materialId', '')::uuid
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

-- The party pages show each bill's material.
create or replace view party_rows with (security_invoker = true) as
select
  e.id as entry_id,
  e.serial,
  e.entry_type,
  e.entry_date,
  e.reference,
  e.narration,
  s.status,
  l.firm_id,
  l.party_id,
  -- Positive: a bill or opening (we owe more) or a payment (we paid), as the workbook shows them.
  case when e.entry_type = 'vendor_payment' then l.amount_paise else -l.amount_paise end as amount_paise,
  (select c.site_id from entry_lines c where c.entry_id = e.id and c.account = 'site_cost' order by c.line_no limit 1) as site_id,
  (select c.cost_head from entry_lines c where c.entry_id = e.id and c.account = 'site_cost' order by c.line_no limit 1) as cost_head,
  (select m.money_account_id from entry_lines m where m.entry_id = e.id and m.account = 'money' limit 1) as money_account_id,
  e.material_id
from entry_lines l
join entries e on e.id = l.entry_id
join entry_status s on s.entry_id = e.id
where l.account = 'vendor_payable' and s.status in ('verified', 'unverified');
