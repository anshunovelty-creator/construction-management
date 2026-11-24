-- Labour payment: everyone is in a family (owner decision 2026-11-23). A single worker is the head of a family of one,
-- and members are added to it as they come. The Workers tab lists the heads; the monthly entry shows each family's
-- members as sub-rows of the head's row. Money already saved keeps its months: a family's ledger adds up its members'
-- months and the money given to the head, so a worker made the head of their own family owes and is owed the same.

update labour_workers set head_id = id where head_id is null;

-- Left empty, or taken out of a family, a person heads a family of their own.
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
          or exists (select 1 from labour_money where worker_id = old.id)) then
    raise exception 'a head of family with members or money given stays the head';
  end if;
  return new;
end $$;

alter table labour_workers alter column head_id set not null;
