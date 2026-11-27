-- A bill from one of our firms to another (owner decision 2026-11-27): material, labour or any cost, with GST and TDS,
-- in both books at once. Its own file, as a new enum value cannot be used in the transaction that adds it.
alter type entry_type add value 'firm_bill';
