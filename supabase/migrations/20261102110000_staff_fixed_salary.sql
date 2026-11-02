-- Staff are paid a fixed salary per month (owner decision 2026-11-02): no OT, and nothing cut for a day off.
-- Their rate in Setup is now the month's salary. Attendance is still marked for them, and a day present costs the
-- site a day's share of the month (the app keeps it on the row as day_pay_paise); their salary itself is the fixed
-- amount, worked out by the app, not the sum of their days.
comment on column parties.rate_paise is 'Worker: per hour. Staff: salary per month.';

create or replace function labour_day_must_be_worker() returns trigger
language plpgsql as $$
declare
  v_kind party_kind := (select kind from parties where id = new.party_id);
begin
  if v_kind is null or v_kind not in ('worker', 'staff') then
    raise exception 'party % is not a worker or staff', new.party_id;
  end if;
  if v_kind = 'staff' and new.ot_hours <> 0 then
    raise exception 'staff get a fixed salary, no OT (party %)', new.party_id;
  end if;
  return new;
end $$;
