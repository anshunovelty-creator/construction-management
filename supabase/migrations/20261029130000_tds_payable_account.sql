-- TDS we deduct from a vendor's bill is owed to the government. Its own migration: a new enum value
-- cannot be used in the transaction that adds it.
alter type ledger_account add value 'tds_payable';
