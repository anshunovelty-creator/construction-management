-- Bank and cash, stage 5: free money and the eight weeks ahead. Nothing here moves money: it is worked out from the books.
-- See docs/superpowers/specs/2026-11-24-bank-cash-stage5-design.md.

-- How long after a bill it is paid (a party's) or expected (a client's). Empty: due on its date.
alter table parties add column credit_days integer check (credit_days between 0 and 365);
-- The day of the month salaries and wages are paid.
alter table firms add column salary_day integer not null default 7 check (salary_day between 1 and 28);

-- Money expected to come in or go out that no bill says yet: rent, an instalment, a retention to be released.
create table planned_money (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms (id),
  name text not null check (btrim(name) <> ''),
  direction text not null check (direction in ('in', 'out')),
  amount_paise bigint not null check (amount_paise > 0),
  repeats text not null check (repeats in ('once', 'week', 'month')),
  next_on date not null,
  until_on date check (until_on >= next_on),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create trigger planned_money_audit after insert or update or delete on planned_money
  for each row execute function log_master_change('id');
alter table planned_money enable row level security;
create policy planned_money_all on planned_money for all to authenticated
  using (app_my_role() in ('owner', 'office') and app_has_firm(firm_id)) with check (app_my_role() in ('owner', 'office') and app_has_firm(firm_id));
grant select, insert, delete on planned_money to authenticated;

-- A forecast kept on a day, to compare later with what happened. firm_id empty: all firms together (owner).
create table kept_forecasts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references firms (id),
  made_on date not null,
  -- [{"end": "2026-11-30", "closing": 12345}]
  weeks jsonb not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);
create unique index kept_forecasts_once on kept_forecasts (coalesce(firm_id, '00000000-0000-0000-0000-000000000000'::uuid), made_on);
alter table kept_forecasts enable row level security;
create policy kept_forecasts_all on kept_forecasts for all to authenticated
  using (case when firm_id is null then app_is_owner() else app_my_role() in ('owner', 'office') and app_has_firm(firm_id) end)
  with check (case when firm_id is null then app_is_owner() else app_my_role() in ('owner', 'office') and app_has_firm(firm_id) end);
grant select, insert, delete on kept_forecasts to authenticated;

-- What a firm's accounts held at the end of a day (all firms when none is given), as the person may see them.
create function money_at(p_firm uuid, p_date date) returns bigint
language sql stable set search_path = public as $$
  select coalesce(sum(l.amount_paise), 0)::bigint
  from entry_lines l join entries e on e.id = l.entry_id
  where l.account = 'money' and l.firm_id is not null and (p_firm is null or l.firm_id = p_firm) and e.entry_date <= p_date
$$;
grant execute on function money_at(uuid, date) to authenticated;
