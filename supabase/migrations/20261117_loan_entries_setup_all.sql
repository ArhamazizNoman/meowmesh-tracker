-- ONE-SHOT full setup for the Loan page table. Safe to run any number of
-- times — it only creates what is missing. Run this if the Loan page shows
-- "saved on this device" instead of "cloud synced".
CREATE TABLE IF NOT EXISTS loan_entries (
  id          TEXT PRIMARY KEY,
  entry_date  DATE NOT NULL,
  kind        TEXT NOT NULL,
  amount      INTEGER NOT NULL DEFAULT 0,  -- the taka (৳) amount
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Columns added by later features (no-ops if they already exist)
ALTER TABLE loan_entries ADD COLUMN IF NOT EXISTS bdt         NUMERIC;
ALTER TABLE loan_entries ADD COLUMN IF NOT EXISTS repaid      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE loan_entries ADD COLUMN IF NOT EXISTS repaid_date DATE;
ALTER TABLE loan_entries ADD COLUMN IF NOT EXISTS repaid_note TEXT;

ALTER TABLE loan_entries ENABLE ROW LEVEL SECURITY;

-- Browser (anon key) needs read + write; re-create the policies cleanly.
DROP POLICY IF EXISTS "loan_entries anon select" ON loan_entries;
DROP POLICY IF EXISTS "loan_entries anon insert" ON loan_entries;
DROP POLICY IF EXISTS "loan_entries anon update" ON loan_entries;
DROP POLICY IF EXISTS "loan_entries anon delete" ON loan_entries;
CREATE POLICY "loan_entries anon select" ON loan_entries FOR SELECT TO anon USING (true);
CREATE POLICY "loan_entries anon insert" ON loan_entries FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "loan_entries anon update" ON loan_entries FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "loan_entries anon delete" ON loan_entries FOR DELETE TO anon USING (true);
