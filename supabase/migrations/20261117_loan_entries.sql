-- Personal loan ledger: money MeowMesh owes the owner, mainly Facebook/Meta
-- ad spend paid out of pocket. Written from the browser (Loan page) with the
-- anon key, so anon insert/select/delete policies are required.
CREATE TABLE IF NOT EXISTS loan_entries (
  id          TEXT PRIMARY KEY,
  entry_date  DATE NOT NULL,
  kind        TEXT NOT NULL,          -- 'owe' = I paid for ads | 'repay' = business paid me back
  amount      INTEGER NOT NULL,       -- amount in BDT (৳)
  usd         NUMERIC,                -- original USD amount if entered in USD, else NULL
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE loan_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loan_entries anon select" ON loan_entries;
DROP POLICY IF EXISTS "loan_entries anon insert" ON loan_entries;
DROP POLICY IF EXISTS "loan_entries anon delete" ON loan_entries;

CREATE POLICY "loan_entries anon select" ON loan_entries FOR SELECT TO anon USING (true);
CREATE POLICY "loan_entries anon insert" ON loan_entries FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "loan_entries anon delete" ON loan_entries FOR DELETE TO anon USING (true);
