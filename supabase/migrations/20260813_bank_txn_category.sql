-- Add a category to bank transactions so they can be filed into cost buckets
-- (Manufacturing, Salary, Marketing, …) from the Bank page.
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS category TEXT DEFAULT '';
