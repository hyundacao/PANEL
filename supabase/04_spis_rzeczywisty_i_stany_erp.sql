-- 04. Spis rzeczywisty i stany ERP
-- Wklej CALY plik do SQL Editor i uruchom Run. Kolejnosc pierwszego uruchomienia: 01-09.
-- Zachowuje istniejace dane i zabezpieczenia. Dodaje historie nazw kartotek oraz bezpieczna funkcje aktualizacji nazw.
-- Nie resetuje danych, magazynow, kont, grup, zadan, raportow ani stanow.
-- Powtorne uruchomienie nie powiela danych. Jeden plik = jedna transakcja.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = public, extensions, pg_catalog;

-- SQL_SOURCE_BEGIN: tabela/original_inventory_catalog
-- original_inventory_catalog: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.original_inventory_catalog') is null then
    create table public."original_inventory_catalog" (
    "id" uuid default gen_random_uuid() not null,
    "name" text not null,
    "unit" text not null,
    "index_code" text,
    "warehouse_code" text,
    "created_at" timestamp with time zone default now() not null,
    constraint "original_inventory_catalog_pkey" PRIMARY KEY (id)
    );
    CREATE UNIQUE INDEX original_inventory_catalog_name_index_idx ON public.original_inventory_catalog USING btree (lower(name), COALESCE(lower(index_code), ''::text));
    alter table public."original_inventory_catalog" enable row level security;
    grant all on table public."original_inventory_catalog" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/original_inventory_catalog

-- SQL_SOURCE_BEGIN: tabela/original_inventory_entries
-- original_inventory_entries: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.original_inventory_entries') is null then
    create table public."original_inventory_entries" (
    "id" uuid default gen_random_uuid() not null,
    "at" timestamp with time zone default now() not null,
    "warehouse_id" text not null,
    "name" text not null,
    "qty" numeric not null,
    "unit" text not null,
    "location" text,
    "note" text,
    "user_name" text not null,
    "source_type" text,
    "source_id" text,
    constraint "original_inventory_entries_pkey" PRIMARY KEY (id),
    constraint "original_inventory_entries_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT
    );
    CREATE INDEX original_inventory_entries_date_idx ON public.original_inventory_entries USING btree (at);
    CREATE UNIQUE INDEX original_inventory_entries_source_idx ON public.original_inventory_entries USING btree (source_type, source_id) WHERE ((source_type IS NOT NULL) AND (source_id IS NOT NULL));
    alter table public."original_inventory_entries" enable row level security;
    grant all on table public."original_inventory_entries" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/original_inventory_entries

-- SQL_SOURCE_BEGIN: tabela/original_inventory_erp_snapshots
-- original_inventory_erp_snapshots: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.original_inventory_erp_snapshots') is null then
    create table public."original_inventory_erp_snapshots" (
    "id" uuid default gen_random_uuid() not null,
    "snapshot_date" date not null,
    "name" text not null,
    "real_qty" numeric default 0 not null,
    "available_qty" numeric default 0 not null,
    "unit" text not null,
    "index_code" text,
    "warehouse_code" text,
    "imported_at" timestamp with time zone default now() not null,
    "imported_by" text not null,
    "source_file_name" text,
    "qty" numeric,
    constraint "original_inventory_erp_snapshots_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX original_inventory_erp_snapshots_date_idx ON public.original_inventory_erp_snapshots USING btree (snapshot_date);
    CREATE UNIQUE INDEX original_inventory_erp_snapshots_date_name_index_idx ON public.original_inventory_erp_snapshots USING btree (snapshot_date, lower(name), COALESCE(lower(index_code), ''::text));
    alter table public."original_inventory_erp_snapshots" enable row level security;
    grant all on table public."original_inventory_erp_snapshots" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/original_inventory_erp_snapshots

-- SQL_SOURCE_BEGIN: tabela/original_inventory_silos
-- original_inventory_silos: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.original_inventory_silos') is null then
    create table public."original_inventory_silos" (
    "id" uuid not null,
    "name" text not null,
    "chamber" text not null,
    "material_name" text not null,
    "warehouse_id" text not null,
    "percent_kg" numeric default 0 not null,
    "hopper_kg" numeric default 0 not null,
    "is_active" boolean default true not null,
    "order_no" integer default 0 not null,
    "updated_at" timestamp with time zone default now() not null,
    constraint "original_inventory_silos_pkey" PRIMARY KEY (id),
    constraint "original_inventory_silos_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT
    );
    alter table public."original_inventory_silos" enable row level security;
    grant all on table public."original_inventory_silos" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/original_inventory_silos

-- SQL_SOURCE_BEGIN: tabela/original_inventory_silo_entries
-- original_inventory_silo_entries: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.original_inventory_silo_entries') is null then
    create table public."original_inventory_silo_entries" (
    "id" uuid not null,
    "config_id" uuid not null,
    "date_key" text not null,
    "percent" numeric default 0 not null,
    "hopper_present" boolean default false not null,
    "calculated_qty" numeric default 0 not null,
    "generated_entry_id" uuid,
    "user_name" text default 'nieznany'::text not null,
    "updated_at" timestamp with time zone default now() not null,
    constraint "original_inventory_silo_entries_config_id_date_key_key" UNIQUE (config_id, date_key),
    constraint "original_inventory_silo_entries_config_id_fkey" FOREIGN KEY (config_id) REFERENCES original_inventory_silos(id) ON DELETE CASCADE,
    constraint "original_inventory_silo_entries_generated_entry_id_fkey" FOREIGN KEY (generated_entry_id) REFERENCES original_inventory_entries(id) ON DELETE SET NULL,
    constraint "original_inventory_silo_entries_pkey" PRIMARY KEY (id)
    );
    alter table public."original_inventory_silo_entries" enable row level security;
    grant all on table public."original_inventory_silo_entries" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/original_inventory_silo_entries

-- SQL_SOURCE_BEGIN: tabela/original_inventory_grind_tasks
-- original_inventory_grind_tasks: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.original_inventory_grind_tasks') is null then
    create table public."original_inventory_grind_tasks" (
    "id" uuid not null,
    "material_name" text not null,
    "target_material_name" text,
    "qty" numeric default 0 not null,
    "unit" text default 'kg'::text not null,
    "status" text default 'PENDING'::text not null,
    "source_report_date" text,
    "created_by" text default 'nieznany'::text not null,
    "created_at" timestamp with time zone default now() not null,
    "completed_by" text,
    "completed_at" timestamp with time zone,
    constraint "original_inventory_grind_tasks_pkey" PRIMARY KEY (id),
    constraint "original_inventory_grind_tasks_status_check" CHECK (status = ANY (ARRAY['PENDING'::text, 'DONE'::text]))
    );
    CREATE INDEX original_inventory_grind_tasks_status_created_idx ON public.original_inventory_grind_tasks USING btree (status, created_at DESC);
    alter table public."original_inventory_grind_tasks" enable row level security;
    grant all on table public."original_inventory_grind_tasks" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/original_inventory_grind_tasks

-- SQL_SOURCE_BEGIN: aktualizacja/nazwy_kartotek
-- Poprzednie nazwy lacza historyczne spisy z aktualna kartoteka bez zmiany ilosci.
alter table public.original_inventory_catalog
  add column if not exists previous_names text[] not null default '{}';

create or replace function public.rename_original_inventory_catalog_items(p_changes jsonb)
returns table(id uuid, updated boolean)
language plpgsql
security definer
set search_path = public, pg_catalog
as $rename$
declare
  change jsonb;
  changed_id uuid;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'CHANGES_ARRAY_REQUIRED';
  end if;
  if jsonb_array_length(p_changes) > 500 then raise exception 'TOO_MANY_CHANGES'; end if;
  for change in select value from jsonb_array_elements(p_changes)
  loop
    changed_id := null;
    begin
      update public.original_inventory_catalog c
      set name = btrim(change ->> 'name'),
          previous_names = array(select distinct n from unnest(c.previous_names || array[c.name]) n where btrim(n) <> '')
      where c.id = (change ->> 'id')::uuid
        and c.name = change ->> 'previousName'
        and c.index_code = change ->> 'indexCode'
        and btrim(coalesce(change ->> 'name', '')) <> ''
        and btrim(coalesce(change ->> 'indexCode', '')) <> ''
      returning c.id into changed_id;
    exception when unique_violation then
      changed_id := null;
    end;
    return query select (change ->> 'id')::uuid, changed_id is not null;
  end loop;
end;
$rename$;
revoke all on function public.rename_original_inventory_catalog_items(jsonb) from public, anon, authenticated;
grant execute on function public.rename_original_inventory_catalog_items(jsonb) to service_role;
-- SQL_SOURCE_END: aktualizacja/nazwy_kartotek

notify pgrst, 'reload schema';
commit;

select 'Spis rzeczywisty i stany ERP' as modul, 'OK'::text as wynik;
