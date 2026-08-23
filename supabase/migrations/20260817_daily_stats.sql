-- Cache of per-day sales & ad-spend for the Sales page, so historical days
-- load instantly and only recent/missing days are refetched from WooCommerce
-- and Meta. Written only by the fetch-dashboard edge function (service role,
-- which bypasses RLS), so no anon policies are needed.
CREATE TABLE IF NOT EXISTS daily_stats (
  date        DATE PRIMARY KEY,
  orders      INTEGER NOT NULL DEFAULT 0,
  items       INTEGER NOT NULL DEFAULT 0,
  sales       INTEGER NOT NULL DEFAULT 0,
  cancelled   INTEGER NOT NULL DEFAULT 0,
  spend_usd   NUMERIC,               -- NULL = Meta spend not fetched yet for this day
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;
