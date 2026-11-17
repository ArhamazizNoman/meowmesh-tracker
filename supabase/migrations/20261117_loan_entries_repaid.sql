-- Let an ad-spend entry be marked repaid in place (from the list), recording
-- when it was paid back, instead of only via a separate repayment entry.
-- Also add the anon UPDATE policy so the browser can PATCH these rows.
ALTER TABLE loan_entries ADD COLUMN IF NOT EXISTS repaid      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE loan_entries ADD COLUMN IF NOT EXISTS repaid_date DATE;
ALTER TABLE loan_entries ADD COLUMN IF NOT EXISTS repaid_note TEXT;

DROP POLICY IF EXISTS "loan_entries anon update" ON loan_entries;
CREATE POLICY "loan_entries anon update" ON loan_entries FOR UPDATE TO anon USING (true) WITH CHECK (true);
