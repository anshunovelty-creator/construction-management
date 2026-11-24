-- Bank and cash, stage 1 (docs/superpowers/specs/2026-11-24-bank-cash-stage1-design.md): money nobody recognises yet is
-- written down at once and sorted out later. Its own file, because a new enum value cannot be used in the transaction
-- that adds it.
alter type ledger_account add value 'not_yet_known';
alter type entry_type add value 'not_yet_known';
