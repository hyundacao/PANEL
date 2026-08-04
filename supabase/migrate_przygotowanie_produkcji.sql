create table if not exists public.przygotowanie_produkcji_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null default current_date,
  file_name text,
  plan_sheet text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_date)
);

create table if not exists public.przygotowanie_produkcji_tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.przygotowanie_produkcji_sessions(id) on delete cascade,
  task_key text not null,
  position_no integer not null default 0,
  is_current_plan boolean not null default true,
  plan_group text not null default 'standard',
  station text not null,
  detail text not null,
  quantity text,
  norm text,
  highlighted boolean not null default false,
  kinds jsonb not null default '[]'::jsonb,
  teams jsonb not null default '[]'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  done boolean not null default false,
  material text not null default '',
  material_type text not null default '',
  source text not null default '',
  dryer text not null default '',
  temperature text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (session_id, task_key)
);

create index if not exists przygotowanie_produkcji_sessions_date_idx
  on public.przygotowanie_produkcji_sessions (session_date desc);
create index if not exists przygotowanie_produkcji_tasks_session_idx
  on public.przygotowanie_produkcji_tasks (session_id, position_no);

create table if not exists public.przygotowanie_produkcji_history (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null unique,
  file_name text,
  plan_sheet text,
  tasks jsonb not null default '[]'::jsonb,
  archived_at timestamptz not null default now(),
  archived_by text
);

create index if not exists przygotowanie_produkcji_history_date_idx
  on public.przygotowanie_produkcji_history (plan_date desc);

alter table public.przygotowanie_produkcji_tasks
  add column if not exists is_current_plan boolean not null default true;

alter table public.przygotowanie_produkcji_tasks
  add column if not exists plan_group text not null default 'standard';

alter table public.przygotowanie_produkcji_sessions enable row level security;
alter table public.przygotowanie_produkcji_tasks enable row level security;
alter table public.przygotowanie_produkcji_history enable row level security;
