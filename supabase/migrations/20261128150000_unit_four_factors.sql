-- A fifth way to measure a unit (owner decision 2026-11-28, asked for by the supervisors): No. × four boxes A × B × C × D,
-- any meaning (e.g. steel: members × bars × length × kg per metre). Work done keeps only the text and the quantity.
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
  where conrelid = 'units'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%measure%';
  if v_name is null then raise exception 'units measure check not found'; end if;
  execute format('alter table units drop constraint %I', v_name);
end $$;
alter table units add constraint units_measure check (measure in ('quantity', 'length', 'area', 'volume', 'factors'));
