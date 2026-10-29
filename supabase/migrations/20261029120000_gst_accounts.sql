-- GST on bills. Its own file: Postgres cannot use a new enum value in the transaction that adds it.
-- gst_input: GST on a vendor's bill, which the firm claims back. gst_output: GST on a client bill, owed to the government.
alter type ledger_account add value 'gst_input';
alter type ledger_account add value 'gst_output';
