-- A party's GST number (GSTIN), kept on the party so it can be found from its page. Empty when not known.
-- Format: 2-digit state code, 5 letters, 4 digits, 1 letter, 1 letter-or-digit, Z, 1 check character.
alter table parties add column gst_number text not null default ''
  check (gst_number = '' or gst_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
