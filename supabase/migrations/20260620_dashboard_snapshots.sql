create table if not exists dashboard_snapshots (
  id          int primary key default 1,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Only one row ever exists (id=1). Anyone with anon key can read it.
alter table dashboard_snapshots enable row level security;

create policy "anon read" on dashboard_snapshots
  for select using (true);

create policy "service role write" on dashboard_snapshots
  for all using (auth.role() = 'service_role');
