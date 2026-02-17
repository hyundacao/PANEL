-- ERP target locations (lokalizacje docelowe) for Warehouse Transfer Documents.
-- Safe to run multiple times.

begin;

create table if not exists public.erp_target_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  order_no integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists erp_target_locations_name_lower_uq
  on public.erp_target_locations (lower(name));

create index if not exists erp_target_locations_active_order_idx
  on public.erp_target_locations (is_active, order_no, name);

alter table if exists public.erp_target_locations enable row level security;

insert into public.erp_target_locations (name, order_no, is_active)
values
  ('HALA 1', 1, true),
  ('HALA 2', 2, true),
  ('HALA 3', 3, true),
  ('BAKOMA', 4, true),
  ('PACZKA', 5, true),
  ('LAKIERNIA', 6, true),
  ('INNA LOKALIZACJA', 999, true)
on conflict do nothing;

commit;

notify pgrst, 'reload schema';
