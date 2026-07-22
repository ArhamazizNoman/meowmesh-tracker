-- Seed cost-per-unit prices for all MeowMesh products (from product cost breakdown sheet)
INSERT INTO product_costs (product_name, cost_per_unit) VALUES
  ('Mesh Play 365',                  740),
  ('Cozy Corner',                   1355),
  ('Meow Bari',                     1200),
  ('Mesh Pounching Post Big Size',  4350),
  ('Litter Box Single',             1640),
  ('Litter Box Double',             2920),
  ('Pounching Post Small Size',     2760),
  ('Mansion Single One',             990),
  ('Mansion 3 Busket',              2060),
  ('Macrame Hammock',                525),
  ('Adventure Zone',                1580),
  ('Mesh Jadur Box',                 665),
  ('Pow Cot',                        925),
  ('Mesh Stand Sketcher',           1350),
  ('Mesh House',                    2550)
ON CONFLICT (product_name) DO UPDATE
  SET cost_per_unit = EXCLUDED.cost_per_unit,
      updated_at    = NOW();
