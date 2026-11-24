-- Advance is typed on Labour payment → Monthly entry (owner decision 2026-11-24), with its reason; Addition and Deduction
-- are gone from the sheet (what old months have stays counted). A typed advance is a record on the worker's account: it
-- takes no money out of a bank or cash. Paid still comes only from the Pay page.
--
-- Also: saving a month again arrives as an insert that finds the row there, so what the row has is looked up for an
-- insert too. Before, a month with an old Paid could not be saved again.
create or replace function labour_months_no_money() returns trigger
language plpgsql as $$
declare
  v_paid bigint := case when tg_op = 'UPDATE' then old.paid_paise
    else coalesce((select paid_paise from labour_months where worker_id = new.worker_id and month = new.month), 0) end;
begin
  if auth.uid() is not null and new.paid_paise <> v_paid then
    raise exception 'money paid is kept on the Pay page, with its date and the account it came from';
  end if;
  return new;
end $$;
