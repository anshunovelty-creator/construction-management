-- Labour supply families (owner decision 2026-11-21): a whole family works, and only its head is paid. Each member keeps
-- their own day salary and monthly days (labour_months); the money given to the head is kept with its date in
-- labour_money, against the head. A head's head_id is their own id; a member's is the head's.
-- See docs/superpowers/specs/2026-11-05-labour-supply-design.md.

alter table labour_workers add column head_id uuid references labour_workers (id);
create index labour_workers_head on labour_workers (head_id);

create function labour_workers_head_check() returns trigger
language plpgsql as $$
begin
  if new.head_id is not null and new.head_id <> new.id
     and not exists (select 1 from labour_workers where id = new.head_id and head_id = id) then
    raise exception 'a family member must belong to a head of family';
  end if;
  if tg_op = 'UPDATE' and old.head_id = old.id and new.head_id is distinct from new.id
     and (exists (select 1 from labour_workers where head_id = old.id and id <> old.id)
          or exists (select 1 from labour_money where worker_id = old.id)) then
    raise exception 'a head of family with members or money given stays the head';
  end if;
  return new;
end $$;
create trigger labour_workers_head_check before insert or update of head_id on labour_workers
  for each row execute function labour_workers_head_check();
