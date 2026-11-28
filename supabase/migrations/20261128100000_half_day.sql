-- Half day on the daily report (owner decision 2026-11-28, asked for by the supervisors): a worker who leaves at half
-- the day is marked H. They count as present (one site a day still), and the day pays half the day's pay, rounded to
-- the paisa; OT stays a full day ÷ 8 per hour. Staff are on a fixed salary, so they are only P or A.

alter table labour_day add column half_day boolean not null default false;
alter table labour_day add constraint labour_day_half_is_present check (not half_day or present);

-- The amount check was made without a name: find it by what it says.
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
  where conrelid = 'labour_day'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%amount_paise%day_pay_paise%';
  if v_name is null then raise exception 'labour_day amount check not found'; end if;
  execute format('alter table labour_day drop constraint %I', v_name);
end $$;

alter table labour_day add constraint labour_day_amount check (amount_paise =
  case when not present then 0 when half_day then round(day_pay_paise::numeric / 2) else day_pay_paise end
  + round(ot_hours * day_pay_paise / 8));

create or replace function labour_day_must_be_worker() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind party_kind := (select kind from parties where id = new.party_id);
begin
  if v_kind is null or v_kind not in ('worker', 'staff') then
    raise exception 'party % is not a worker or staff', new.party_id;
  end if;
  if v_kind = 'staff' then
    if new.ot_hours <> 0 then
      raise exception 'staff get a fixed salary, no OT (party %)', new.party_id;
    end if;
    if new.half_day then
      raise exception 'staff get a fixed salary, no half day (party %)', new.party_id;
    end if;
    new.day_pay_paise := 0;
    new.amount_paise := 0;
  end if;
  return new;
end $$;
