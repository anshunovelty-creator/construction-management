-- Bank and cash, stage 2 (owner decisions 2026-11-24): money and work between our own firms, as one entry in both books.
-- See docs/superpowers/specs/2026-11-24-bank-cash-stage2-design.md. Enum values in a file of their own, as they cannot
-- be used in the transaction that adds them.
alter type ledger_account add value 'firm_income';
alter type entry_type add value 'firm_transfer';
alter type entry_type add value 'labour_supplied';
alter type entry_type add value 'machine_rent';
