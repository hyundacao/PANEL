begin;

insert into public.warehouses (id, name, order_no, include_in_spis, include_in_stats, is_active) values
  ('bakoma', 'Bakoma', 3, true, true, true),
  ('lakiernia', 'Lakiernia', 4, true, true, true)
on conflict (id) do update set
  name = excluded.name,
  order_no = excluded.order_no,
  include_in_spis = true,
  include_in_stats = true,
  is_active = true;

create table if not exists public.material_planning_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

create table if not exists public.material_planning_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text not null default ''
);

create index if not exists material_planning_events_created_at_idx
  on public.material_planning_events (created_at desc);

alter table public.material_planning_state enable row level security;
alter table public.material_planning_events enable row level security;

comment on table public.material_planning_state is
  'Stan osobnego modułu planowania zapotrzebowania. Dostęp wyłącznie przez autoryzowane API aplikacji.';
comment on table public.material_planning_events is
  'Techniczny dziennik zapisów modułu planowania zapotrzebowania.';

commit;
