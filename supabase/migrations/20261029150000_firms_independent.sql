-- Firms are independent for money: a new entry may not move money from one firm to another.
-- Inter-firm lines already in the books stay (they are history). Cancelling an entry that has them still
-- works, because a reversal copies its original's lines exactly.
create function entry_lines_firms_independent() returns trigger
language plpgsql as $$
begin
  if new.account = 'inter_firm'
     and (select reverses_entry_id from entries where id = new.entry_id) is null then
    raise exception 'firms are independent: money cannot move between firms';
  end if;
  return new;
end $$;

create trigger entry_lines_firms_independent before insert on entry_lines
  for each row execute function entry_lines_firms_independent();
