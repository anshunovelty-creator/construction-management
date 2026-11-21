-- A running account for each worker and staff member on the Salary page (owner decision 2026-11-21): money given
-- (paid or an advance) and money taken off (a deduction) are kept with their date, like labour_money for the labour
-- supply heads. PF is cut from salary; whether it is cut is kept from a month on (salary_pf), so switching it later
-- leaves earlier months as they were. With no row, staff have PF cut and workers do not (src/lib/wages.ts).

create table salary_money (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties (id),
  money_date date not null,
  kind text not null check (kind in ('advance', 'payment', 'deduction')),
  amount_paise bigint not null check (amount_paise > 0),
  method text check (method in ('cash', 'bank')),
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  check ((kind = 'deduction') = (method is null)),
  check (kind <> 'deduction' or btrim(note) <> '')
);
create index salary_money_party on salary_money (party_id, money_date);

create table salary_pf (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references parties (id),
  from_month date not null check (extract(day from from_month) = 1),
  cut boolean not null,
  unique (party_id, from_month)
);

create function salary_party_must_be_worker() returns trigger
language plpgsql as $$
begin
  if coalesce((select kind::text from parties where id = new.party_id), '') not in ('worker', 'staff') then
    raise exception 'party % is not a worker or staff', new.party_id;
  end if;
  return new;
end $$;
create trigger salary_money_worker_kind before insert or update on salary_money
  for each row execute function salary_party_must_be_worker();
create trigger salary_pf_worker_kind before insert or update on salary_pf
  for each row execute function salary_party_must_be_worker();

create trigger salary_money_audit after insert or update or delete on salary_money
  for each row execute function log_master_change('id');
create trigger salary_pf_audit after insert or update or delete on salary_pf
  for each row execute function log_master_change('id');

-- The office and owner keep salaries, as they see the Salary page. A line typed by mistake is removed, never edited.
alter table salary_money enable row level security;
create policy salary_money_read on salary_money for select to authenticated using (app_my_role() in ('owner', 'office'));
create policy salary_money_add on salary_money for insert to authenticated
  with check (app_my_role() in ('owner', 'office') and created_by = auth.uid());
create policy salary_money_remove on salary_money for delete to authenticated using (app_my_role() in ('owner', 'office'));
grant select, insert, delete on salary_money to authenticated;

alter table salary_pf enable row level security;
create policy salary_pf_all on salary_pf for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));
grant select, insert, update on salary_pf to authenticated;
