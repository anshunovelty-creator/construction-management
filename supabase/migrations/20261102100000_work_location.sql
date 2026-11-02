-- Work done: where on the site it was done (washroom, 1st floor, room 2…). Optional; older lines have none.
alter table work_done add column location text check (btrim(location) <> '');
