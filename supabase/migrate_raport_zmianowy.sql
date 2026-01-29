drop table if exists public.zeszyt_receipts;
drop table if exists public.zeszyt_items;
drop table if exists public.zeszyt_sessions;

create table if not exists public.raport_zmianowy_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text not null,
  session_date date not null default current_date,
  plan_sheet text not null,
  file_name text
);

create index if not exists raport_zmianowy_sessions_date_idx
  on public.raport_zmianowy_sessions (session_date);

create table if not exists public.raport_zmianowy_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.raport_zmianowy_sessions(id) on delete cascade,
  index_code text not null,
  description text,
  station text,
  created_at timestamptz not null default now()
);

create index if not exists raport_zmianowy_items_session_idx
  on public.raport_zmianowy_items (session_id);
create index if not exists raport_zmianowy_items_index_idx
  on public.raport_zmianowy_items (index_code);
create index if not exists raport_zmianowy_items_station_idx
  on public.raport_zmianowy_items (station);

create table if not exists public.raport_zmianowy_entries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.raport_zmianowy_items(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now(),
  author_id uuid,
  author_name text not null,
  edited_at timestamptz,
  edited_by_id uuid,
  edited_by_name text
);

create index if not exists raport_zmianowy_entries_item_idx
  on public.raport_zmianowy_entries (item_id);
create index if not exists raport_zmianowy_entries_created_idx
  on public.raport_zmianowy_entries (created_at);

alter table if exists public.raport_zmianowy_sessions enable row level security;
alter table if exists public.raport_zmianowy_items enable row level security;
alter table if exists public.raport_zmianowy_entries enable row level security;
