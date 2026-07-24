-- Day-to-day cash book: one row per income/expense entry.
-- Written directly from the browser with the anon key (like monthly_costs),
-- so anon needs full read/write access.
CREATE TABLE IF NOT EXISTS daily_entries (
  id          TEXT PRIMARY KEY,
  entry_date  DATE NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('income','expense')),
  category    TEXT NOT NULL DEFAULT 'Other',
  note        TEXT DEFAULT '',
  amount      INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS daily_entries_date_idx ON daily_entries (entry_date);

ALTER TABLE daily_entries ENABLE ROW LEVEL SECURITY;

-- Anon key may read and write (single-tenant internal ops tool).
DROP POLICY IF EXISTS "anon read"   ON daily_entries;
DROP POLICY IF EXISTS "anon write"  ON daily_entries;
DROP POLICY IF EXISTS "anon update" ON daily_entries;
DROP POLICY IF EXISTS "anon delete" ON daily_entries;
CREATE POLICY "anon read"   ON daily_entries FOR SELECT USING (true);
CREATE POLICY "anon write"  ON daily_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "anon update" ON daily_entries FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "anon delete" ON daily_entries FOR DELETE USING (true);
