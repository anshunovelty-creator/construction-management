-- One note per site per day on the daily report (owner decision 2026-11-28, asked for by the supervisors): what kind of
-- work was done, any extra work, anything the owner should know. Plain text, shown on the report and its printed sheet.
-- Unlike the report's lines it can be changed: anyone who can see the site may write it, and the change log keeps every
-- version and who wrote it. Emptied, it is removed.

create table report_note (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  work_date date not null,
  note text not null check (btrim(note) <> '' and length(note) <= 4000),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  unique (site_id, work_date)
);

create trigger report_note_audit after insert or update or delete on report_note
  for each row execute function log_master_change('id');

alter table report_note enable row level security;
create policy report_note_read on report_note for select to authenticated using (app_has_site(site_id));
create policy report_note_add on report_note for insert to authenticated with check (app_has_site(site_id));
create policy report_note_change on report_note for update to authenticated
  using (app_has_site(site_id)) with check (app_has_site(site_id));
create policy report_note_remove on report_note for delete to authenticated using (app_has_site(site_id));
grant select, insert, update, delete on report_note to authenticated;
