-- The PF rate is kept in Setup → PF rates (owner decision 2026-11-21), each counting from the month of its date until
-- a later one: changing the rate from a month leaves earlier months as they were. With none, 12% (src/lib/wages.ts).
create table pf_rates (
  id uuid primary key default gen_random_uuid(),
  from_date date not null unique,
  rate_bp integer not null check (rate_bp between 0 and 10000),
  created_at timestamptz not null default now()
);
insert into pf_rates (from_date, rate_bp) values ('2026-01-01', 1200);

create trigger pf_rates_audit after insert or update or delete on pf_rates
  for each row execute function log_master_change('id');

alter table pf_rates enable row level security;
create policy pf_rates_all on pf_rates for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));
grant select, insert, update on pf_rates to authenticated;
