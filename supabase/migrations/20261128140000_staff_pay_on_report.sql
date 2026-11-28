-- Staff pay on the supervisor's daily report (owner decision 2026-11-28, replacing 2026-11-25's "supervisors do not see
-- staff salaries"): the report is every rupee spent at the site, so a staff member's day (monthly salary ÷ days in the
-- month) is shown to the supervisor too and counted in the report's cost. Staff stay out of a supervisor's Setup.

-- The staff to mark on a daily report, now with their monthly salary (has_rate stays for code from before).
drop function app_site_staff();
create function app_site_staff()
returns table (id uuid, name text, site_id uuid, has_rate boolean, rate_paise bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.site_id, p.rate_paise is not null, p.rate_paise from parties p
  where p.kind = 'staff' and p.is_active and app_my_role() in ('owner', 'office', 'supervisor')
$$;
revoke all on function app_site_staff() from public, anon;
grant execute on function app_site_staff() to authenticated;

-- A staff day's pay: read by whoever can read that day's attendance (owner, office, the site's supervisor).
drop policy labour_day_staff_read on labour_day_staff;
create policy labour_day_staff_read on labour_day_staff for select to authenticated
  using (exists (select 1 from labour_day d where d.id = labour_day_id and app_has_site(d.site_id)));
