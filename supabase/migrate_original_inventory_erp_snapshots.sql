create table if not exists public.original_inventory_erp_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  name text not null,
  qty numeric not null,
  unit text not null,
  imported_at timestamptz not null default now(),
  imported_by text not null,
  source_file_name text
);

create index if not exists original_inventory_erp_snapshots_date_idx
  on public.original_inventory_erp_snapshots (snapshot_date);

create unique index if not exists original_inventory_erp_snapshots_date_name_idx
  on public.original_inventory_erp_snapshots (snapshot_date, lower(name));

alter table if exists public.original_inventory_erp_snapshots enable row level security;
