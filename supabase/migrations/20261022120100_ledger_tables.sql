-- Ledger tables. Entries and lines are append-only; status lives in entry_events.

create type ledger_account as enum (
  'money',
  'vendor_payable',
  'client_receivable',
  'retention_held',
  'security_deposit_held',
  'tds_claimable',
  'inter_firm',
  'site_cost',
  'contract_income',
  'owner_capital',
  'opening_balance',
  'cash_short_excess'
);

create type entry_type as enum (
  'opening',
  'vendor_bill',
  'vendor_payment',
  'site_cash_expense',
  'client_bill',
  'client_receipt',
  'cash_transfer',
  'cash_close_difference',
  'owner_capital',
  'owner_drawing',
  'reversal'
);

create type entry_event_kind as enum ('verified', 'rejected', 'reversed', 'replaced', 'lock_override');

create table serial_counters (
  series text not null,
  fy text not null,
  last_seq integer not null check (last_seq > 0),
  primary key (series, fy)
);

create table entries (
  id uuid primary key,
  serial text not null unique,
  series text not null,
  fy text not null check (fy ~ '^\d{2}-\d{2}$'),
  seq integer not null check (seq > 0),
  entry_type entry_type not null,
  entry_date date not null,
  firm_id uuid references firms (id),
  party_id uuid references parties (id),
  reference text not null default '',
  narration text not null default '',
  reverses_entry_id uuid unique references entries (id),
  replaces_entry_id uuid unique references entries (id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  created_txid bigint not null default txid_current(),
  unique (series, fy, seq),
  check ((entry_type = 'reversal') = (reverses_entry_id is not null)),
  check ((series = 'CM') = (firm_id is null))
);

create table entry_lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null references entries (id),
  line_no smallint not null check (line_no > 0),
  account ledger_account not null,
  amount_paise bigint not null check (amount_paise <> 0),
  firm_id uuid references firms (id),
  counter_firm_id uuid references firms (id),
  money_account_id uuid references money_accounts (id),
  party_id uuid references parties (id),
  site_id uuid references sites (id),
  work_order_id uuid references work_orders (id),
  cost_head cost_head,
  unique (entry_id, line_no),
  -- Each account allows exactly the dimensions it needs, so posting bugs fail loudly.
  constraint line_dimensions check (
    case account
      when 'money' then
        money_account_id is not null and counter_firm_id is null and party_id is null
        and site_id is null and work_order_id is null and cost_head is null
      when 'vendor_payable' then
        firm_id is not null and party_id is not null and counter_firm_id is null
        and money_account_id is null and site_id is null and work_order_id is null and cost_head is null
      when 'inter_firm' then
        firm_id is not null and counter_firm_id is not null and firm_id <> counter_firm_id
        and money_account_id is null and party_id is null and site_id is null
        and work_order_id is null and cost_head is null
      when 'site_cost' then
        site_id is not null and cost_head is not null and counter_firm_id is null and money_account_id is null
      when 'owner_capital' then
        counter_firm_id is null and money_account_id is null and party_id is null
        and site_id is null and work_order_id is null and cost_head is null
      when 'opening_balance' then
        counter_firm_id is null and money_account_id is null and party_id is null
        and site_id is null and work_order_id is null and cost_head is null
      when 'cash_short_excess' then
        counter_firm_id is null and money_account_id is null and party_id is null
        and site_id is null and work_order_id is null and cost_head is null
      -- client_receivable, retention_held, security_deposit_held, tds_claimable, contract_income
      else
        firm_id is not null and party_id is not null and site_id is not null and work_order_id is not null
        and counter_firm_id is null and money_account_id is null and cost_head is null
    end
  )
);

create index entry_lines_entry on entry_lines (entry_id);
create index entry_lines_account_firm_party on entry_lines (account, firm_id, party_id);
create index entry_lines_site on entry_lines (site_id) where site_id is not null;
create index entry_lines_money_account on entry_lines (money_account_id) where money_account_id is not null;

create table entry_events (
  id bigint generated always as identity primary key,
  entry_id uuid not null references entries (id),
  kind entry_event_kind not null,
  actor uuid not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  check (kind = 'verified' or btrim(reason) <> '')
);

create unique index entry_events_one_verified on entry_events (entry_id) where kind = 'verified';
create unique index entry_events_one_terminal on entry_events (entry_id)
  where kind in ('rejected', 'reversed', 'replaced');

create table books_locks (
  id bigint generated always as identity primary key,
  locked_through date not null,
  actor uuid not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
