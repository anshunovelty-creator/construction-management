-- Money borrowed (owner decision 2026-11-27): a friend who lends the firm money is kept as a party of kind lender.
-- Borrowing and returning are other_in / other_out entries against the loan account that name the lender on the entry;
-- the loan line itself keeps no party, so loans from before stay valid.
alter type party_kind add value if not exists 'lender';
