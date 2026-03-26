alter table if exists public.original_inventory_catalog
  add column if not exists index_code text;

alter table if exists public.original_inventory_catalog
  add column if not exists warehouse_code text;

drop index if exists original_inventory_catalog_name_idx;

create unique index if not exists original_inventory_catalog_name_index_idx
  on public.original_inventory_catalog (
    lower(name),
    coalesce(lower(index_code), '')
  );
