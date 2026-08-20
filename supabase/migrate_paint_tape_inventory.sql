create table if not exists public.paint_tape_inventory_catalog (
  id uuid primary key default gen_random_uuid(),
  item_index text not null unique,
  item_code text,
  name text not null,
  category text not null default 'INNE',
  unit text not null default 'szt.',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text not null default 'system'
);

create index if not exists paint_tape_inventory_catalog_active_order_idx
  on public.paint_tape_inventory_catalog (is_active, sort_order, name);

create table if not exists public.paint_tape_inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  inventory_date date not null unique,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  expected_count integer not null default 0,
  checked_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by text not null default 'nieznany',
  completed_at timestamptz,
  completed_by text
);

create index if not exists paint_tape_inventory_sessions_date_idx
  on public.paint_tape_inventory_sessions (inventory_date desc);

create table if not exists public.paint_tape_inventory_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.paint_tape_inventory_sessions(id) on delete cascade,
  catalog_item_id uuid not null references public.paint_tape_inventory_catalog(id) on delete restrict,
  qty numeric not null check (qty >= 0),
  location text,
  note text,
  checked_at timestamptz not null default now(),
  checked_by text not null default 'nieznany'
);

alter table if exists public.paint_tape_inventory_entries
  add column if not exists location text;

alter table if exists public.paint_tape_inventory_entries
  drop constraint if exists paint_tape_inventory_entries_session_id_catalog_item_id_key;

create index if not exists paint_tape_inventory_entries_session_idx
  on public.paint_tape_inventory_entries (session_id, checked_at);

create index if not exists paint_tape_inventory_entries_item_idx
  on public.paint_tape_inventory_entries (session_id, catalog_item_id, checked_at);

alter table if exists public.paint_tape_inventory_catalog enable row level security;
alter table if exists public.paint_tape_inventory_sessions enable row level security;
alter table if exists public.paint_tape_inventory_entries enable row level security;

notify pgrst, 'reload schema';
