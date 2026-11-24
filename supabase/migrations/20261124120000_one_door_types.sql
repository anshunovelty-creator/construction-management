-- Bank and cash, stage 3: every rupee in and out goes through a bankbook line. Enum values in a file of their own, as
-- they cannot be used in the transaction that adds them. See docs/superpowers/specs/2026-11-24-bank-cash-stage3-design.md.
alter type ledger_account add value 'wages_paid';
alter type ledger_account add value 'firm_cost';
alter type ledger_account add value 'other_income';
alter type ledger_account add value 'loan';
alter type ledger_account add value 'deposit_given';
alter type ledger_account add value 'gst_paid';
alter type ledger_account add value 'tds_paid';
alter type ledger_account add value 'pf_paid';
alter type ledger_account add value 'tds_claimed';
alter type entry_type add value 'wages_paid';
alter type entry_type add value 'other_in';
alter type entry_type add value 'other_out';
alter type cost_head add value 'office';
alter type cost_head add value 'bank_charges';
alter type cost_head add value 'interest';
alter type cost_head add value 'machine_service';
