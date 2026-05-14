create table if not exists public.original_inventory_grind_tasks (
  id uuid primary key,
  material_name text not null,
  target_material_name text,
  qty numeric not null default 0,
  unit text not null default 'kg',
  status text not null default 'PENDING' check (status in ('PENDING', 'DONE')),
  source_report_date text,
  created_by text not null default 'nieznany',
  created_at timestamptz not null default now(),
  completed_by text,
  completed_at timestamptz
);

alter table if exists public.original_inventory_grind_tasks
  add column if not exists target_material_name text;

create index if not exists original_inventory_grind_tasks_status_created_idx
  on public.original_inventory_grind_tasks(status, created_at desc);

alter table if exists public.original_inventory_grind_tasks enable row level security;
