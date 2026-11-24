-- Labour payment: a family's opening balance (owner decision 2026-11-23). When the app starts, a family may already be
-- owed money, or have been paid extra. It is typed once per family, against its head, with the month it counts from:
-- it joins that month's "from last month" and carries on from there like any balance.

create table labour_openings (
  worker_id uuid primary key references labour_workers (id),
  month date not null check (extract(day from month) = 1),
  -- Above zero still to pay; below zero paid extra, which comes off the next salary.
  amount_paise bigint not null check (amount_paise <> 0),
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create function labour_openings_head_check() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from labour_workers where id = new.worker_id and head_id = id) then
    raise exception 'an opening balance belongs to a head of family';
  end if;
  return new;
end $$;
create trigger labour_openings_head_check before insert or update on labour_openings
  for each row execute function labour_openings_head_check();

-- A head with members, money given or an opening balance stays the head.
create or replace function labour_workers_head_check() returns trigger
language plpgsql as $$
begin
  if new.head_id is null then
    new.head_id := new.id;
  end if;
  if new.head_id <> new.id
     and not exists (select 1 from labour_workers where id = new.head_id and head_id = id) then
    raise exception 'a family member must belong to a head of family';
  end if;
  if tg_op = 'UPDATE' and old.head_id = old.id and new.head_id <> new.id
     and (exists (select 1 from labour_workers where head_id = old.id and id <> old.id)
          or exists (select 1 from labour_money where worker_id = old.id)
          or exists (select 1 from labour_openings where worker_id = old.id)) then
    raise exception 'a head of family with members or money given stays the head';
  end if;
  return new;
end $$;

create trigger labour_openings_audit after insert or update or delete on labour_openings
  for each row execute function log_master_change('worker_id');

alter table labour_openings enable row level security;
create policy labour_openings_all on labour_openings for all to authenticated
  using (app_labour_access()) with check (app_labour_access());
grant select, insert, update, delete on labour_openings to authenticated;
