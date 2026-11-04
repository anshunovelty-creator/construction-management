-- A used line picked from a combination work names it, so the daily report shows that work as a group with its
-- materials inside (owner decision 2026-11-04). The name is kept as it was that day. Empty: not part of a work.
alter table material_use add column mix_name text not null default '';
