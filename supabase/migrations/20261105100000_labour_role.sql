-- A login for the labour supply business only. Added on its own: a new enum value cannot be used in the transaction
-- that adds it.
alter type app_role add value 'labour';
