-- 06. Przygotowanie produkcji
-- Wklej CALY plik do SQL Editor i uruchom Run. Kolejnosc pierwszego uruchomienia: 01-09.
-- Istniejace tabele, indeksy, funkcje, RLS i uprawnienia pozostaja bez zmian.
-- Nie resetuje danych, magazynow, kont, grup, zadan, raportow ani stanow.
-- Powtorne uruchomienie nie powiela danych. Jeden plik = jedna transakcja.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = public, extensions, pg_catalog;

-- SQL_SOURCE_BEGIN: tabela/przygotowanie_produkcji_sessions
-- przygotowanie_produkcji_sessions: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.przygotowanie_produkcji_sessions') is null then
    create table public."przygotowanie_produkcji_sessions" (
    "id" uuid default gen_random_uuid() not null,
    "session_date" date default CURRENT_DATE not null,
    "file_name" text,
    "plan_sheet" text,
    "created_by" text not null,
    "created_at" timestamp with time zone default now() not null,
    "updated_at" timestamp with time zone default now() not null,
    constraint "przygotowanie_produkcji_sessions_pkey" PRIMARY KEY (id),
    constraint "przygotowanie_produkcji_sessions_session_date_key" UNIQUE (session_date)
    );
    CREATE INDEX przygotowanie_produkcji_sessions_date_idx ON public.przygotowanie_produkcji_sessions USING btree (session_date DESC);
    alter table public."przygotowanie_produkcji_sessions" enable row level security;
    grant all on table public."przygotowanie_produkcji_sessions" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/przygotowanie_produkcji_sessions

-- SQL_SOURCE_BEGIN: tabela/przygotowanie_produkcji_tasks
-- przygotowanie_produkcji_tasks: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.przygotowanie_produkcji_tasks') is null then
    create table public."przygotowanie_produkcji_tasks" (
    "id" uuid default gen_random_uuid() not null,
    "session_id" uuid not null,
    "task_key" text not null,
    "position_no" integer default 0 not null,
    "station" text not null,
    "detail" text not null,
    "quantity" text,
    "norm" text,
    "highlighted" boolean default false not null,
    "kinds" jsonb default '[]'::jsonb not null,
    "teams" jsonb default '[]'::jsonb not null,
    "notes" jsonb default '{}'::jsonb not null,
    "done" boolean default false not null,
    "material" text default ''::text not null,
    "material_type" text default ''::text not null,
    "source" text default ''::text not null,
    "dryer" text default ''::text not null,
    "temperature" text default ''::text not null,
    "created_at" timestamp with time zone default now() not null,
    "updated_at" timestamp with time zone default now() not null,
    "updated_by" text,
    "is_current_plan" boolean default true not null,
    "plan_group" text default 'standard'::text not null,
    constraint "przygotowanie_produkcji_tasks_pkey" PRIMARY KEY (id),
    constraint "przygotowanie_produkcji_tasks_session_id_fkey" FOREIGN KEY (session_id) REFERENCES przygotowanie_produkcji_sessions(id) ON DELETE CASCADE,
    constraint "przygotowanie_produkcji_tasks_session_id_task_key_key" UNIQUE (session_id, task_key)
    );
    CREATE INDEX przygotowanie_produkcji_tasks_session_idx ON public.przygotowanie_produkcji_tasks USING btree (session_id, position_no);
    alter table public."przygotowanie_produkcji_tasks" enable row level security;
    grant all on table public."przygotowanie_produkcji_tasks" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/przygotowanie_produkcji_tasks

-- SQL_SOURCE_BEGIN: tabela/przygotowanie_produkcji_history
-- przygotowanie_produkcji_history: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.przygotowanie_produkcji_history') is null then
    create table public."przygotowanie_produkcji_history" (
    "id" uuid default gen_random_uuid() not null,
    "plan_date" date not null,
    "file_name" text,
    "plan_sheet" text,
    "tasks" jsonb default '[]'::jsonb not null,
    "archived_at" timestamp with time zone default now() not null,
    "archived_by" text,
    constraint "przygotowanie_produkcji_history_pkey" PRIMARY KEY (id),
    constraint "przygotowanie_produkcji_history_plan_date_key" UNIQUE (plan_date)
    );
    CREATE INDEX przygotowanie_produkcji_history_date_idx ON public.przygotowanie_produkcji_history USING btree (plan_date DESC);
    alter table public."przygotowanie_produkcji_history" enable row level security;
    grant all on table public."przygotowanie_produkcji_history" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/przygotowanie_produkcji_history

notify pgrst, 'reload schema';
commit;

select 'Przygotowanie produkcji' as modul, 'OK'::text as wynik;
