-- Bank and cash, stage 4: rounding gets an account of its own, so cash short or extra is only ever counted cash. In a file
-- of its own, as a new enum value cannot be used in the transaction that adds it.
alter type ledger_account add value 'round_off';
