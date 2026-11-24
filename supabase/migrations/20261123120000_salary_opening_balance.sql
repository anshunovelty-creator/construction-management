-- Salary opening balance (owner decision 2026-11-23): for settling with the many workers and staff already on the books,
-- one balance per person from before the app, like labour_openings for labour payment families. It counts in the month
-- chosen as if it came from the month before ("From before" on the slip) and carries on from there (salaryLedger in
-- src/lib/wages.ts). Above zero we still had to pay them; below zero they had been paid extra.

create table salary_openings (
  party_id uuid primary key references parties (id),
  month date not null check (extract(day from month) = 1),
  amount_paise bigint not null check (amount_paise <> 0),
  note text not null default '',
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create trigger salary_openings_worker_kind before insert or update on salary_openings
  for each row execute function salary_party_must_be_worker();
create trigger salary_openings_audit after insert or update or delete on salary_openings
  for each row execute function log_master_change('party_id');

alter table salary_openings enable row level security;
create policy salary_openings_all on salary_openings for all to authenticated
  using (app_my_role() in ('owner', 'office')) with check (app_my_role() in ('owner', 'office'));
grant select, insert, update, delete on salary_openings to authenticated;
