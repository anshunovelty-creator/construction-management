-- Things taken on rent for a site (owner decision 2026-11-02): shuttering plates, bamboo, props and the like.
-- The rent meter runs from the day they came until the day they go back: quantity × rate per day × days
-- (worked out on screen by src/lib/rent.ts). The bill number, when the rent bill comes, says which bill covers them.
-- Not a ledger row: the rent bill itself is entered as a party's bill as usual.
create table rentals (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  vendor_id uuid references parties (id),
  item text not null check (btrim(item) <> ''),
  quantity numeric(14, 3) not null check (quantity > 0),
  rate_paise bigint not null check (rate_paise > 0),
  rented_on date not null,
  returned_on date check (returned_on >= rented_on),
  bill_no text check (btrim(bill_no) <> ''),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create index rentals_site on rentals (site_id, rented_on);

create trigger rentals_audit after insert or update or delete on rentals
  for each row execute function log_master_change('id');

-- Like the daily report: supervisors for their own sites, the owner and office for any. Only the return date and the
-- bill number change later; a line typed wrong is removed by the office, or by whoever added it on the same day.
alter table rentals enable row level security;
create policy rentals_read on rentals for select to authenticated using (app_has_site(site_id));
create policy rentals_add on rentals for insert to authenticated
  with check (app_has_site(site_id) and created_by = auth.uid());
create policy rentals_return on rentals for update to authenticated
  using (app_has_site(site_id)) with check (app_has_site(site_id));
create policy rentals_remove on rentals for delete to authenticated
  using (
    app_my_role() in ('owner', 'office')
    or (created_by = auth.uid()
        and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)
  );
grant select, insert, delete on rentals to authenticated;
grant update (returned_on, bill_no) on rentals to authenticated;
