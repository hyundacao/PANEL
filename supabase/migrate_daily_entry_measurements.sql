create table if not exists public.daily_entry_measurements (
  id uuid primary key default gen_random_uuid(),
  date_key date not null,
  location_id text not null references public.locations(id) on delete cascade,
  material_id text not null references public.materials(id) on delete restrict,
  qty numeric not null default 0,
  comment text,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists daily_entry_measurements_lookup_idx
  on public.daily_entry_measurements (date_key, location_id, material_id);
