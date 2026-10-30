-- How a unit is measured on the daily report (owner decision 2026-10-30): M3 by length × width × height,
-- M2 by length × width, running feet by length, and the rest (Nos, Bags, Kg) by the quantity itself.
alter table units add column measure text not null default 'quantity'
  check (measure in ('quantity', 'length', 'area', 'volume'));

update units set measure = 'volume' where name in ('M3', 'CFT');
update units set measure = 'area' where name in ('M2', 'SFT');
update units set measure = 'length' where name in ('RFT');
