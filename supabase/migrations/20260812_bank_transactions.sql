-- Bank transactions imported from statement CSV/Excel exports.
-- Written from the browser with the anon key (like the other tables).
CREATE TABLE IF NOT EXISTS bank_transactions (
  id          TEXT PRIMARY KEY,       -- deterministic hash of the row (dedupes re-imports)
  txn_date    DATE NOT NULL,
  description TEXT DEFAULT '',
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount      INTEGER NOT NULL DEFAULT 0,   -- always positive; direction gives sign
  balance     INTEGER,                       -- running balance if the statement has it
  ref         TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_txn_date_idx ON bank_transactions(txn_date);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read"   ON bank_transactions;
DROP POLICY IF EXISTS "anon write"  ON bank_transactions;
DROP POLICY IF EXISTS "anon update" ON bank_transactions;
DROP POLICY IF EXISTS "anon delete" ON bank_transactions;
CREATE POLICY "anon read"   ON bank_transactions FOR SELECT USING (true);
CREATE POLICY "anon write"  ON bank_transactions FOR INSERT WITH CHECK (true);
CREATE POLICY "anon update" ON bank_transactions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "anon delete" ON bank_transactions FOR DELETE USING (true);
