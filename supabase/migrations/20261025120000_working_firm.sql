-- The firm each person is working in: the switcher at the top right of the app.
-- A preference, not master data, so it has no audit trigger: switching back and forth
-- leaves nothing in the change log.

create table working_firms (
  user_id uuid primary key references profiles (user_id),
  firm_id uuid not null references firms (id),
  updated_at timestamptz not null default now()
);

-- Everyone reads only their own choice. Changes go only through app_set_my_firm.
alter table working_firms enable row level security;
create policy working_firms_read on working_firms for select to authenticated using (user_id = auth.uid());
grant select on working_firms to authenticated;

-- Owner: any firm. Office staff: their assigned firms. Supervisors work at sites, not in a firm.
create function app_set_my_firm(p_firm_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if app_my_role() is null then
    raise exception 'not signed in, or this account is deactivated';
  end if;
  if not app_has_firm(p_firm_id) then
    raise exception 'you are not assigned to this firm';
  end if;
  insert into working_firms (user_id, firm_id) values (auth.uid(), p_firm_id)
  on conflict (user_id) do update set firm_id = excluded.firm_id, updated_at = now();
end $$;

grant execute on function app_set_my_firm(uuid) to authenticated;
