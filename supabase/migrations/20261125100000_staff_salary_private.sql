-- Supervisors do not see what staff are paid (owner decision 2026-11-25). They still mark staff present or absent on the
-- daily report: the staff list reaches them without salaries, and a staff day's pay is kept apart, for the owner and office.

drop policy parties_read on parties;
create policy parties_read on parties for select to authenticated
  using (app_my_role() <> 'labour' and (app_my_role() <> 'supervisor' or kind <> 'staff'));
drop policy parties_supervisor_add on parties;
create policy parties_supervisor_add on parties for insert to authenticated
  with check (app_my_role() = 'supervisor' and kind = 'worker');
drop policy parties_supervisor_edit on parties;
create policy parties_supervisor_edit on parties for update to authenticated
  using (app_my_role() = 'supervisor' and kind = 'worker')
  with check (app_my_role() = 'supervisor' and kind = 'worker');

-- The staff to mark on a daily report: who, and whether a salary is set, never how much.
create function app_site_staff()
returns table (id uuid, name text, site_id uuid, has_rate boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.site_id, p.rate_paise is not null from parties p
  where p.kind = 'staff' and p.is_active and app_my_role() in ('owner', 'office', 'supervisor')
$$;
revoke all on function app_site_staff() from public, anon;
grant execute on function app_site_staff() to authenticated;

-- What a staff member's day comes to: a day's share of the monthly salary, as it was when the day was marked.
create table labour_day_staff (
  labour_day_id uuid primary key references labour_day (id) on delete cascade,
  day_pay_paise bigint not null check (day_pay_paise >= 0),
  amount_paise bigint not null check (amount_paise >= 0)
);
alter table labour_day_staff enable row level security;
create policy labour_day_staff_read on labour_day_staff for select to authenticated
  using (app_my_role() in ('owner', 'office'));
grant select on labour_day_staff to authenticated;

-- Days already marked keep their amounts, in their new place.
insert into labour_day_staff (labour_day_id, day_pay_paise, amount_paise)
  select d.id, d.day_pay_paise, d.amount_paise from labour_day d join parties p on p.id = d.party_id where p.kind = 'staff';
alter table labour_day disable trigger labour_day_audit;
update labour_day d set day_pay_paise = 0, amount_paise = 0 from parties p where p.id = d.party_id and p.kind = 'staff';
alter table labour_day enable trigger labour_day_audit;

-- Runs as its owner: a supervisor cannot read staff, but may mark them.
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
    new.day_pay_paise := 0;
    new.amount_paise := 0;
  end if;
  return new;
end $$;

create function labour_day_staff_pay() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_party parties%rowtype;
  v_day bigint;
begin
  select * into v_party from parties where id = new.party_id;
  if v_party.kind = 'staff' then
    v_day := round(coalesce(v_party.rate_paise, 0)::numeric
      / extract(day from date_trunc('month', new.work_date) + interval '1 month - 1 day')::numeric);
    insert into labour_day_staff values (new.id, v_day, case when new.present then v_day else 0 end);
  end if;
  return new;
end $$;
create trigger labour_day_staff_pay after insert on labour_day for each row execute function labour_day_staff_pay();
