-- Entry lifecycle: cancel (reverse), reject, verify, replace, and the derived status.

-- Cancels an entry by posting its exact opposite. p_kind records why: reversed, rejected or replaced.
create function reverse_entry(
  p_entry_id uuid,
  p_actor uuid,
  p_reason text,
  p_kind entry_event_kind default 'reversed',
  p_reversal_id uuid default gen_random_uuid()
) returns jsonb
language plpgsql as $$
declare
  v_original entries%rowtype;
  v_lines jsonb;
  v_result jsonb;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to cancel an entry';
  end if;
  if p_kind not in ('reversed', 'rejected', 'replaced') then
    raise exception 'invalid cancel kind %', p_kind;
  end if;

  select * into v_original from entries where id = p_entry_id;
  if not found then
    raise exception 'entry % not found', p_entry_id;
  end if;
  if v_original.entry_type = 'reversal' then
    raise exception 'entry % is itself a reversal and cannot be cancelled', v_original.serial;
  end if;
  if exists (
    select 1 from entry_events
    where entry_id = p_entry_id and kind in ('rejected', 'reversed', 'replaced')
  ) then
    raise exception 'entry % is already cancelled', v_original.serial;
  end if;

  select jsonb_agg(jsonb_build_object(
    'account', account,
    'amountPaise', -amount_paise,
    'firmId', firm_id,
    'counterFirmId', counter_firm_id,
    'moneyAccountId', money_account_id,
    'partyId', party_id,
    'siteId', site_id,
    'workOrderId', work_order_id,
    'costHead', cost_head
  ) order by line_no) into v_lines
  from entry_lines where entry_id = p_entry_id;

  v_result := insert_entry(
    jsonb_build_object(
      'id', p_reversal_id,
      'entryType', 'reversal',
      'entryDate', v_original.entry_date,
      'firmId', v_original.firm_id,
      'partyId', v_original.party_id,
      'reference', v_original.reference,
      'narration', 'Cancels ' || v_original.serial || ': ' || p_reason,
      'reversesEntryId', v_original.id,
      'lines', v_lines
    ),
    p_actor,
    p_reason
  );

  insert into entry_events (entry_id, kind, actor, reason) values (p_entry_id, p_kind, p_actor, p_reason);
  return v_result;
end $$;

-- Rejecting is for unverified entries, and never by the person who entered them.
create function reject_entry(p_entry_id uuid, p_actor uuid, p_reason text) returns jsonb
language plpgsql as $$
declare
  v_original entries%rowtype;
begin
  select * into v_original from entries where id = p_entry_id;
  if not found then
    raise exception 'entry % not found', p_entry_id;
  end if;
  if v_original.created_by = p_actor then
    raise exception 'you cannot reject your own entry %; cancel it instead', v_original.serial;
  end if;
  if exists (select 1 from entry_events where entry_id = p_entry_id and kind = 'verified') then
    raise exception 'entry % is already verified; cancel it instead of rejecting', v_original.serial;
  end if;
  return reverse_entry(p_entry_id, p_actor, p_reason, 'rejected');
end $$;

create function verify_entry(p_entry_id uuid, p_actor uuid) returns void
language plpgsql as $$
declare
  v_original entries%rowtype;
begin
  select * into v_original from entries where id = p_entry_id;
  if not found then
    raise exception 'entry % not found', p_entry_id;
  end if;
  if v_original.entry_type = 'reversal' then
    raise exception 'reversal % does not need verification', v_original.serial;
  end if;
  if v_original.created_by = p_actor then
    raise exception 'you cannot verify your own entry %', v_original.serial;
  end if;
  if exists (
    select 1 from entry_events
    where entry_id = p_entry_id and kind in ('rejected', 'reversed', 'replaced')
  ) then
    raise exception 'entry % is cancelled', v_original.serial;
  end if;
  if exists (select 1 from entry_events where entry_id = p_entry_id and kind = 'verified') then
    raise exception 'entry % is already verified', v_original.serial;
  end if;
  insert into entry_events (entry_id, kind, actor) values (p_entry_id, 'verified', p_actor);
end $$;

-- Editing = cancel the old entry and post the corrected one, linked, in one transaction.
create function replace_entry(p_old_id uuid, p_new jsonb, p_actor uuid, p_reason text) returns jsonb
language plpgsql as $$
declare
  v_reversal jsonb;
  v_new jsonb;
begin
  if p_new ->> 'entryType' = 'reversal' then
    raise exception 'the replacement cannot be a reversal';
  end if;
  v_reversal := reverse_entry(p_old_id, p_actor, p_reason, 'replaced');
  v_new := insert_entry(p_new || jsonb_build_object('replacesEntryId', p_old_id), p_actor, p_reason);
  return jsonb_build_object('reversal', v_reversal, 'entry', v_new);
end $$;

-- unverified | verified | cancelled | reversal
create view entry_status as
select
  e.id as entry_id,
  case
    when e.entry_type = 'reversal' then 'reversal'
    when exists (
      select 1 from entry_events v
      where v.entry_id = e.id and v.kind in ('rejected', 'reversed', 'replaced')
    ) then 'cancelled'
    when exists (select 1 from entry_events v where v.entry_id = e.id and v.kind = 'verified') then 'verified'
    else 'unverified'
  end as status
from entries e;
