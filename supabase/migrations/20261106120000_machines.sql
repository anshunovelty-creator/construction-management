-- The client's AJAX machines, out on rent with other parties, and a record of each service: the date, the running
-- hours on the meter and what it cost. A record only: the service cost does not post to the ledger or either firm.
create table machines (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  rented_to text not null default '',
  -- A service falls due after this many running hours.
  service_every_hours integer not null default 500 check (service_every_hours > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Never changed: a line typed wrong is taken off and typed again, and the change log keeps it.
create table machine_services (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references machines (id),
  service_date date not null,
  running_hours numeric(10, 1) not null check (running_hours >= 0),
  cost_paise bigint not null check (cost_paise >= 0),
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create index machine_services_machine on machine_services (machine_id, service_date);

create trigger machines_audit after insert or update or delete on machines
  for each row execute function log_master_change('id');
create trigger machine_services_audit after insert or update or delete on machine_services
  for each row execute function log_master_change('id');

alter table machines enable row level security;
create policy machines_all on machines for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));
grant select, insert, update on machines to authenticated;

alter table machine_services enable row level security;
create policy machine_services_all on machine_services for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));
grant select, insert, delete on machine_services to authenticated;
