-- Signed-in users read site_rows, like party_rows and client_rows. Default privileges are revoked in this
-- schema, so every view needs its own grant; the view itself runs as the caller (security_invoker).
grant select on site_rows to authenticated;
