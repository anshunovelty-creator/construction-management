-- Things bought to keep and reuse at any site (axes, bowls, tools) are the company's assets, not a site's cost
-- (owner decision 2026-11-02). A new ledger account holds them; its own file, because a new enum value cannot be
-- used in the same transaction that adds it.
alter type ledger_account add value 'company_assets';
