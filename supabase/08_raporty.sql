-- 08. Raporty
-- Wklej CALY plik do SQL Editor i uruchom Run. Kolejnosc pierwszego uruchomienia: 01-09.
-- Istniejace tabele, indeksy, funkcje, RLS i uprawnienia pozostaja bez zmian.
-- Nie resetuje danych, magazynow, kont, grup, zadan, raportow ani stanow.
-- Powtorne uruchomienie nie powiela danych. Jeden plik = jedna transakcja.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = public, extensions, pg_catalog;

-- SQL_SOURCE_BEGIN: tabela/raport_zmianowy_sessions
-- raport_zmianowy_sessions: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.raport_zmianowy_sessions') is null then
    create table public."raport_zmianowy_sessions" (
    "id" uuid default gen_random_uuid() not null,
    "created_at" timestamp with time zone default now() not null,
    "created_by" text not null,
    "session_date" date default CURRENT_DATE not null,
    "plan_sheet" text not null,
    "file_name" text,
    constraint "raport_zmianowy_sessions_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX raport_zmianowy_sessions_date_idx ON public.raport_zmianowy_sessions USING btree (session_date);
    alter table public."raport_zmianowy_sessions" enable row level security;
    grant all on table public."raport_zmianowy_sessions" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/raport_zmianowy_sessions

-- SQL_SOURCE_BEGIN: tabela/raport_zmianowy_items
-- raport_zmianowy_items: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.raport_zmianowy_items') is null then
    create table public."raport_zmianowy_items" (
    "id" uuid default gen_random_uuid() not null,
    "session_id" uuid not null,
    "index_code" text not null,
    "description" text,
    "station" text,
    "created_at" timestamp with time zone default now() not null,
    constraint "raport_zmianowy_items_pkey" PRIMARY KEY (id),
    constraint "raport_zmianowy_items_session_id_fkey" FOREIGN KEY (session_id) REFERENCES raport_zmianowy_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX raport_zmianowy_items_index_idx ON public.raport_zmianowy_items USING btree (index_code);
    CREATE INDEX raport_zmianowy_items_session_idx ON public.raport_zmianowy_items USING btree (session_id);
    CREATE INDEX raport_zmianowy_items_station_idx ON public.raport_zmianowy_items USING btree (station);
    alter table public."raport_zmianowy_items" enable row level security;
    grant all on table public."raport_zmianowy_items" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/raport_zmianowy_items

-- SQL_SOURCE_BEGIN: tabela/raport_zmianowy_entries
-- raport_zmianowy_entries: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.raport_zmianowy_entries') is null then
    create table public."raport_zmianowy_entries" (
    "id" uuid default gen_random_uuid() not null,
    "item_id" uuid not null,
    "note" text not null,
    "created_at" timestamp with time zone default now() not null,
    "author_id" uuid,
    "author_name" text not null,
    "edited_at" timestamp with time zone,
    "edited_by_id" uuid,
    "edited_by_name" text,
    constraint "raport_zmianowy_entries_item_id_fkey" FOREIGN KEY (item_id) REFERENCES raport_zmianowy_items(id) ON DELETE CASCADE,
    constraint "raport_zmianowy_entries_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX raport_zmianowy_entries_created_idx ON public.raport_zmianowy_entries USING btree (created_at);
    CREATE INDEX raport_zmianowy_entries_item_idx ON public.raport_zmianowy_entries USING btree (item_id);
    alter table public."raport_zmianowy_entries" enable row level security;
    grant all on table public."raport_zmianowy_entries" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/raport_zmianowy_entries

-- SQL_SOURCE_BEGIN: tabela/raport_brakowosci_latest
-- raport_brakowosci_latest: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.raport_brakowosci_latest') is null then
    create table public."raport_brakowosci_latest" (
    "id" text default 'latest'::text not null,
    "payload" jsonb not null,
    "updated_at" timestamp with time zone default now() not null,
    constraint "raport_brakowosci_latest_pkey" PRIMARY KEY (id)
    );
    alter table public."raport_brakowosci_latest" enable row level security;
    grant all on table public."raport_brakowosci_latest" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/raport_brakowosci_latest

notify pgrst, 'reload schema';
commit;

select 'Raporty' as modul, 'OK'::text as wynik;
