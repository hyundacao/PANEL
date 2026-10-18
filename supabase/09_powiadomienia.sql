-- 09. Powiadomienia
-- Wklej CALY plik do SQL Editor i uruchom Run. Kolejnosc pierwszego uruchomienia: 01-09.
-- Istniejace tabele, indeksy, funkcje, RLS i uprawnienia pozostaja bez zmian.
-- Nie resetuje danych, magazynow, kont, grup, zadan, raportow ani stanow.
-- Powtorne uruchomienie nie powiela danych. Jeden plik = jedna transakcja.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = public, extensions, pg_catalog;

-- SQL_SOURCE_BEGIN: tabela/push_subscriptions
-- push_subscriptions: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.push_subscriptions') is null then
    create table public."push_subscriptions" (
    "id" uuid default gen_random_uuid() not null,
    "user_id" uuid not null,
    "endpoint" text not null,
    "p256dh" text not null,
    "auth" text not null,
    "user_agent" text,
    "erp_warehouseman_source_warehouses" text[],
    "erp_dispatcher_target_locations" text[],
    "created_at" timestamp with time zone default now() not null,
    "updated_at" timestamp with time zone default now() not null,
    "last_seen_at" timestamp with time zone default now() not null,
    constraint "push_subscriptions_pkey" PRIMARY KEY (id),
    constraint "push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX push_subscriptions_endpoint_uq ON public.push_subscriptions USING btree (endpoint);
    CREATE INDEX push_subscriptions_last_seen_idx ON public.push_subscriptions USING btree (last_seen_at DESC);
    CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id);
    alter table public."push_subscriptions" enable row level security;
    grant all on table public."push_subscriptions" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/push_subscriptions

notify pgrst, 'reload schema';
commit;

select 'Powiadomienia' as modul, 'OK'::text as wynik;
