-- Only the owner may delete a combination work (owner decision 2026-11-04); everyone signed in still adds and changes
-- them. Its materials go with it. Saved daily reports keep the work's name on their own lines (material_use.mix_name).
drop policy mixes_write on mixes;
create policy mixes_add on mixes for insert to authenticated with check (app_my_role() is not null);
create policy mixes_change on mixes for update to authenticated
  using (app_my_role() is not null) with check (app_my_role() is not null);
create policy mixes_remove on mixes for delete to authenticated using (app_my_role() = 'owner');
grant delete on mixes to authenticated;
