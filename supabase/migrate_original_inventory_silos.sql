alter table original_inventory_entries
  add column if not exists source_type text,
  add column if not exists source_id text;

alter table original_inventory_entries
  alter column warehouse_id drop not null;

create unique index if not exists original_inventory_entries_source_idx
  on original_inventory_entries(source_type, source_id)
  where source_type is not null and source_id is not null;

create table if not exists original_inventory_silos (
  id uuid primary key,
  name text not null,
  chamber text not null,
  material_name text not null,
  warehouse_id text references warehouses(id) on delete restrict,
  percent_kg numeric not null default 0,
  hopper_kg numeric not null default 0,
  is_active boolean not null default true,
  order_no integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists original_inventory_silo_entries (
  id uuid primary key,
  config_id uuid not null references original_inventory_silos(id) on delete cascade,
  date_key text not null,
  percent numeric not null default 0,
  hopper_present boolean not null default false,
  calculated_qty numeric not null default 0,
  generated_entry_id uuid references original_inventory_entries(id) on delete set null,
  user_name text not null default 'nieznany',
  updated_at timestamptz not null default now(),
  unique(config_id, date_key)
);

alter table original_inventory_silos
  alter column warehouse_id drop not null;
