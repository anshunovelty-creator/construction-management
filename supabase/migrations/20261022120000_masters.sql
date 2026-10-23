-- Master data: firms, sites, parties, work orders, money accounts.

create type party_kind as enum ('vendor', 'client', 'worker', 'staff', 'other');
create type contract_type as enum ('item_rate', 'fixed');
create type money_account_kind as enum ('bank', 'owner_cash', 'supervisor_cash');
create type cost_head as enum (
  'material', 'labour', 'staff', 'machine_hire', 'subcontract', 'site_overhead', 'transport', 'other'
);

create table firms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{2,4}$' and code <> 'CM'),
  name text not null unique check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  location text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table parties (
  id uuid primary key default gen_random_uuid(),
  kind party_kind not null,
  name text not null check (btrim(name) <> ''),
  phone text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, name)
);

create table work_orders (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms (id),
  client_id uuid not null references parties (id),
  site_id uuid not null references sites (id),
  ref text not null check (btrim(ref) <> ''),
  contract_type contract_type not null,
  contract_value_paise bigint check (contract_value_paise is null or contract_value_paise > 0),
  tds_bp integer not null default 0 check (tds_bp between 0 and 10000),
  retention_bp integer not null default 0 check (retention_bp between 0 and 10000),
  security_deposit_bp integer not null default 0 check (security_deposit_bp between 0 and 10000),
  start_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (firm_id, ref)
);

create function work_orders_client_must_be_client() returns trigger
language plpgsql as $$
begin
  if (select kind from parties where id = new.client_id) is distinct from 'client' then
    raise exception 'work order client % is not a party of kind client', new.client_id;
  end if;
  return new;
end $$;

create trigger work_orders_client_kind
  before insert or update on work_orders
  for each row execute function work_orders_client_must_be_client();

create table money_accounts (
  id uuid primary key default gen_random_uuid(),
  kind money_account_kind not null,
  name text not null unique check (btrim(name) <> ''),
  firm_id uuid references firms (id),
  holder_user_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Bank accounts belong to a firm; owner cash and supervisor cash are common.
  check ((kind = 'bank') = (firm_id is not null))
);
