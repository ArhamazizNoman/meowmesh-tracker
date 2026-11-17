-- Each loan entry can now carry an amount in all three currencies at once
-- (USD / DKK / BDT), each summed separately. `usd` already exists; add the
-- other two. `amount` (BDT int) stays only to satisfy the NOT NULL column and
-- is no longer used for display. Safe to run more than once.
ALTER TABLE loan_entries ADD COLUMN IF NOT EXISTS dkk NUMERIC;
ALTER TABLE loan_entries ADD COLUMN IF NOT EXISTS bdt NUMERIC;
