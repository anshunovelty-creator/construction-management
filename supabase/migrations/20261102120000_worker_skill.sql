-- Workers and staff: skilled or unskilled, and the skill (mason, carpenter…), for information only (owner decision
-- 2026-11-02). Both optional; pay is unaffected.
alter table parties add column skill_level text check (skill_level in ('skilled', 'unskilled'));
alter table parties add column skill text not null default '';
