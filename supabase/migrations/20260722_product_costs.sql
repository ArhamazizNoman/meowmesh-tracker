-- Stores per-product cost prices (permanent, not per-month)
CREATE TABLE IF NOT EXISTS product_costs (
  product_name  TEXT PRIMARY KEY,
  cost_per_unit INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
