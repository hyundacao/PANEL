alter table if exists public.original_inventory_erp_snapshots
  add column if not exists index_code text;

alter table if exists public.original_inventory_erp_snapshots
  add column if not exists warehouse_code text;

drop index if exists original_inventory_erp_snapshots_date_name_idx;

create unique index if not exists original_inventory_erp_snapshots_date_name_index_idx
  on public.original_inventory_erp_snapshots (
    snapshot_date,
    lower(name),
    coalesce(lower(index_code), '')
  );
