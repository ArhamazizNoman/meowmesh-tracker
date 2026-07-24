-- Small key/value store for app-wide settings shared across devices.
-- Used by the Daily Operations page to hold the edit-code hash so the
-- same code works on every browser. Written from the client with the
-- anon key, so anon needs read/write.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read"   ON app_settings;
DROP POLICY IF EXISTS "anon write"  ON app_settings;
DROP POLICY IF EXISTS "anon update" ON app_settings;
CREATE POLICY "anon read"   ON app_settings FOR SELECT USING (true);
CREATE POLICY "anon write"  ON app_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "anon update" ON app_settings FOR UPDATE USING (true) WITH CHECK (true);
