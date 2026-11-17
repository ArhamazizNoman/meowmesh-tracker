-- Let loan entries remember which currency the amount was entered in
-- (USD, DKK or BDT) and the original figure, while `amount` stays in BDT
-- for all the totals. Safe to run more than once.
ALTER TABLE loan_entries ADD COLUMN IF NOT EXISTS orig_cur TEXT;    -- 'USD' | 'DKK' | 'BDT'
ALTER TABLE loan_entries ADD COLUMN IF NOT EXISTS orig_amt NUMERIC; -- amount in that currency
