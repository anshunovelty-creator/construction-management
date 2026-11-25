-- Who is already present at another site on a day, so the daily report can say so before they are marked again. A
-- supervisor cannot read the other sites' attendance; this tells them only who.
create function app_present_elsewhere(p_site uuid, p_date date)
returns table (party_id uuid)
language sql stable security definer set search_path = public as $$
  select d.party_id from labour_day d
  where d.work_date = p_date and d.present and d.site_id <> p_site and app_has_site(p_site)
$$;
revoke all on function app_present_elsewhere(uuid, date) from public, anon;
grant execute on function app_present_elsewhere(uuid, date) to authenticated;
