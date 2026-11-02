-- Supervisors may add a material from the daily report when the one they used is not on the list yet (owner
-- decision 2026-11-02). Changing or switching off materials stays with the owner and office.
create policy materials_add_supervisor on materials for insert to authenticated
  with check (app_my_role() = 'supervisor');
