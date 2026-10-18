-- 02. Magazyn przemialow
-- Wklej CALY plik do SQL Editor i uruchom Run. Kolejnosc pierwszego uruchomienia: 01-09.
-- Istniejace tabele, indeksy, funkcje, RLS i uprawnienia pozostaja bez zmian.
-- Nie resetuje danych, magazynow, kont, grup, zadan, raportow ani stanow.
-- Powtorne uruchomienie nie powiela danych. Jeden plik = jedna transakcja.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = public, extensions, pg_catalog;

-- SQL_SOURCE_BEGIN: tabela/warehouses
-- warehouses: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.warehouses') is null then
    create table public."warehouses" (
    "id" text not null,
    "name" text not null,
    "order_no" integer default 0 not null,
    "include_in_spis" boolean default true not null,
    "include_in_stats" boolean default true not null,
    "is_active" boolean default true not null,
    constraint "warehouses_pkey" PRIMARY KEY (id)
    );
    alter table public."warehouses" enable row level security;
    grant all on table public."warehouses" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/warehouses

-- SQL_SOURCE_BEGIN: tabela/locations
-- locations: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.locations') is null then
    create table public."locations" (
    "id" text not null,
    "warehouse_id" text not null,
    "name" text not null,
    "order_no" integer default 0 not null,
    "type" text not null,
    "is_active" boolean default true not null,
    constraint "locations_pkey" PRIMARY KEY (id),
    constraint "locations_type_check" CHECK (type = ANY (ARRAY['wtr'::text, 'pole'::text])),
    constraint "locations_warehouse_id_fkey" FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
    );
    alter table public."locations" enable row level security;
    grant all on table public."locations" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/locations

-- SQL_SOURCE_BEGIN: tabela/material_catalogs
-- material_catalogs: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.material_catalogs') is null then
    create table public."material_catalogs" (
    "id" text not null,
    "name" text not null,
    "is_active" boolean default true not null,
    constraint "material_catalogs_pkey" PRIMARY KEY (id)
    );
    CREATE UNIQUE INDEX material_catalogs_name_idx ON public.material_catalogs USING btree (lower(name));
    alter table public."material_catalogs" enable row level security;
    grant all on table public."material_catalogs" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/material_catalogs

-- SQL_SOURCE_BEGIN: tabela/materials
-- materials: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.materials') is null then
    create table public."materials" (
    "id" text not null,
    "code" text default ''::text not null,
    "name" text not null,
    "catalog_id" text,
    "is_active" boolean default true not null,
    constraint "materials_catalog_id_fkey" FOREIGN KEY (catalog_id) REFERENCES material_catalogs(id) ON DELETE SET NULL,
    constraint "materials_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX materials_catalog_idx ON public.materials USING btree (catalog_id);
    CREATE UNIQUE INDEX materials_code_name_idx ON public.materials USING btree (lower(code), lower(name));
    alter table public."materials" enable row level security;
    grant all on table public."materials" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/materials

-- SQL_SOURCE_BEGIN: tabela/daily_entries
-- daily_entries: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.daily_entries') is null then
    create table public."daily_entries" (
    "date_key" date not null,
    "location_id" text not null,
    "material_id" text not null,
    "qty" numeric default 0 not null,
    "confirmed" boolean default false not null,
    "comment" text,
    "updated_at" timestamp with time zone default now() not null,
    constraint "daily_entries_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    constraint "daily_entries_material_id_fkey" FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT,
    constraint "daily_entries_pkey" PRIMARY KEY (date_key, location_id, material_id)
    );
    CREATE INDEX daily_entries_date_idx ON public.daily_entries USING btree (date_key);
    CREATE INDEX daily_entries_location_idx ON public.daily_entries USING btree (location_id);
    CREATE INDEX daily_entries_material_idx ON public.daily_entries USING btree (material_id);
    alter table public."daily_entries" enable row level security;
    grant all on table public."daily_entries" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/daily_entries

-- SQL_SOURCE_BEGIN: tabela/daily_entry_measurements
-- daily_entry_measurements: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.daily_entry_measurements') is null then
    create table public."daily_entry_measurements" (
    "id" uuid default gen_random_uuid() not null,
    "date_key" date not null,
    "location_id" text not null,
    "material_id" text not null,
    "qty" numeric default 0 not null,
    "comment" text,
    "created_at" timestamp with time zone default now() not null,
    "created_by" text,
    constraint "daily_entry_measurements_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    constraint "daily_entry_measurements_material_id_fkey" FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT,
    constraint "daily_entry_measurements_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX daily_entry_measurements_lookup_idx ON public.daily_entry_measurements USING btree (date_key, location_id, material_id);
    alter table public."daily_entry_measurements" enable row level security;
    grant all on table public."daily_entry_measurements" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/daily_entry_measurements

-- SQL_SOURCE_BEGIN: tabela/daily_location_status
-- daily_location_status: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.daily_location_status') is null then
    create table public."daily_location_status" (
    "date_key" date not null,
    "location_id" text not null,
    "is_confirmed" boolean default true not null,
    "created_at" timestamp with time zone default now() not null,
    constraint "daily_location_status_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    constraint "daily_location_status_pkey" PRIMARY KEY (date_key, location_id)
    );
    alter table public."daily_location_status" enable row level security;
    grant all on table public."daily_location_status" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/daily_location_status

-- SQL_SOURCE_BEGIN: tabela/transfers
-- transfers: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.transfers') is null then
    create table public."transfers" (
    "id" uuid default gen_random_uuid() not null,
    "at" timestamp with time zone default now() not null,
    "kind" text not null,
    "material_id" text not null,
    "qty" numeric not null,
    "from_location_id" text,
    "to_location_id" text,
    "legacy_from_location_id" text,
    "legacy_to_location_id" text,
    "partner" text,
    "note" text,
    "cancelled_at" timestamp with time zone,
    "cancelled_by" text,
    constraint "transfers_from_location_id_fkey" FOREIGN KEY (from_location_id) REFERENCES locations(id) ON DELETE SET NULL,
    constraint "transfers_kind_check" CHECK (kind = ANY (ARRAY['INTERNAL'::text, 'EXTERNAL_IN'::text, 'EXTERNAL_OUT'::text])),
    constraint "transfers_material_id_fkey" FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT,
    constraint "transfers_pkey" PRIMARY KEY (id),
    constraint "transfers_to_location_id_fkey" FOREIGN KEY (to_location_id) REFERENCES locations(id) ON DELETE SET NULL
    );
    CREATE INDEX transfers_cancelled_at_idx ON public.transfers USING btree (cancelled_at) WHERE (cancelled_at IS NOT NULL);
    CREATE INDEX transfers_date_idx ON public.transfers USING btree (at);
    CREATE INDEX transfers_material_idx ON public.transfers USING btree (material_id);
    alter table public."transfers" enable row level security;
    grant all on table public."transfers" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/transfers

-- SQL_SOURCE_BEGIN: tabela/inventory_adjustments
-- inventory_adjustments: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.inventory_adjustments') is null then
    create table public."inventory_adjustments" (
    "id" uuid default gen_random_uuid() not null,
    "at" timestamp with time zone default now() not null,
    "location_id" text not null,
    "material_id" text not null,
    "prev_qty" numeric not null,
    "next_qty" numeric not null,
    "note" text,
    "legacy_location_id" text,
    constraint "inventory_adjustments_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE RESTRICT,
    constraint "inventory_adjustments_material_id_fkey" FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE RESTRICT,
    constraint "inventory_adjustments_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX inventory_adjustments_date_idx ON public.inventory_adjustments USING btree (at);
    alter table public."inventory_adjustments" enable row level security;
    grant all on table public."inventory_adjustments" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/inventory_adjustments

-- SQL_SOURCE_BEGIN: tabela/mixed_materials
-- mixed_materials: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.mixed_materials') is null then
    create table public."mixed_materials" (
    "id" uuid default gen_random_uuid() not null,
    "name" text not null,
    "qty" numeric not null,
    "location_id" text not null,
    "legacy_location_id" text,
    constraint "mixed_materials_location_id_fkey" FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    constraint "mixed_materials_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX mixed_materials_location_idx ON public.mixed_materials USING btree (location_id);
    CREATE INDEX mixed_materials_name_idx ON public.mixed_materials USING btree (lower(name));
    alter table public."mixed_materials" enable row level security;
    grant all on table public."mixed_materials" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/mixed_materials

-- SQL_SOURCE_BEGIN: tabela/dryers
-- dryers: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.dryers') is null then
    create table public."dryers" (
    "id" uuid default gen_random_uuid() not null,
    "name" text not null,
    "order_no" integer default 0 not null,
    "is_active" boolean default true not null,
    "material_id" text,
    constraint "dryers_pkey" PRIMARY KEY (id)
    );
    alter table public."dryers" enable row level security;
    grant all on table public."dryers" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/dryers

-- SQL_SOURCE_BEGIN: tabela/audit_logs
-- audit_logs: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.audit_logs') is null then
    create table public."audit_logs" (
    "id" uuid default gen_random_uuid() not null,
    "at" timestamp with time zone default now() not null,
    "user_name" text not null,
    "action" text not null,
    "warehouse" text,
    "location" text,
    "material" text,
    "prev_qty" numeric,
    "next_qty" numeric,
    constraint "audit_logs_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX audit_logs_date_idx ON public.audit_logs USING btree (at);
    alter table public."audit_logs" enable row level security;
    grant all on table public."audit_logs" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/audit_logs

-- SQL_SOURCE_BEGIN: tabela/spare_parts
-- spare_parts: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.spare_parts') is null then
    create table public."spare_parts" (
    "id" text default (gen_random_uuid())::text not null,
    "code" text not null,
    "name" text not null,
    "unit" text not null,
    "qty" numeric default 0 not null,
    "location" text,
    constraint "spare_parts_pkey" PRIMARY KEY (id)
    );
    CREATE UNIQUE INDEX spare_parts_code_idx ON public.spare_parts USING btree (lower(code));
    CREATE UNIQUE INDEX spare_parts_name_idx ON public.spare_parts USING btree (lower(name));
    alter table public."spare_parts" enable row level security;
    grant all on table public."spare_parts" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/spare_parts

-- SQL_SOURCE_BEGIN: tabela/spare_part_history
-- spare_part_history: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.spare_part_history') is null then
    create table public."spare_part_history" (
    "id" uuid default gen_random_uuid() not null,
    "at" timestamp with time zone default now() not null,
    "user_name" text not null,
    "part_id" text not null,
    "part_name" text not null,
    "qty" numeric not null,
    "kind" text not null,
    "note" text,
    constraint "spare_part_history_kind_check" CHECK (kind = ANY (ARRAY['IN'::text, 'OUT'::text])),
    constraint "spare_part_history_part_id_fkey" FOREIGN KEY (part_id) REFERENCES spare_parts(id) ON DELETE CASCADE,
    constraint "spare_part_history_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX spare_part_history_date_idx ON public.spare_part_history USING btree (at);
    alter table public."spare_part_history" enable row level security;
    grant all on table public."spare_part_history" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/spare_part_history

-- SQL_SOURCE_BEGIN: tabela/material_inventory_warehouse_migration_runs
-- material_inventory_warehouse_migration_runs: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.material_inventory_warehouse_migration_runs') is null then
    create table public."material_inventory_warehouse_migration_runs" (
    "id" uuid default gen_random_uuid() not null,
    "started_at" timestamp with time zone default now() not null,
    "note" text not null,
    constraint "material_inventory_warehouse_migration_runs_pkey" PRIMARY KEY (id)
    );
    alter table public."material_inventory_warehouse_migration_runs" enable row level security;
    grant all on table public."material_inventory_warehouse_migration_runs" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/material_inventory_warehouse_migration_runs

-- SQL_SOURCE_BEGIN: tabela/material_inventory_warehouse_migration_report
-- material_inventory_warehouse_migration_report: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.material_inventory_warehouse_migration_report') is null then
    create table public."material_inventory_warehouse_migration_report" (
    "run_id" uuid not null,
    "section" text not null,
    "warehouse_id" text,
    "material_id" text,
    "qty_before" numeric default 0 not null,
    "qty_after" numeric default 0 not null,
    "diff" numeric default 0 not null,
    "details" jsonb default '{}'::jsonb not null,
    "created_at" timestamp with time zone default now() not null,
    constraint "material_inventory_warehouse_migration_report_run_id_fkey" FOREIGN KEY (run_id) REFERENCES material_inventory_warehouse_migration_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX material_inventory_warehouse_migration_report_run_idx ON public.material_inventory_warehouse_migration_report USING btree (run_id, section);
    alter table public."material_inventory_warehouse_migration_report" enable row level security;
    grant all on table public."material_inventory_warehouse_migration_report" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/material_inventory_warehouse_migration_report

-- SQL_SOURCE_BEGIN: tabela/material_inventory_legacy_location_backup
-- material_inventory_legacy_location_backup: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.material_inventory_legacy_location_backup') is null then
    create table public."material_inventory_legacy_location_backup" (
    "run_id" uuid not null,
    "table_name" text not null,
    "row_data" jsonb not null,
    "created_at" timestamp with time zone default now() not null,
    constraint "material_inventory_legacy_location_backup_run_id_fkey" FOREIGN KEY (run_id) REFERENCES material_inventory_warehouse_migration_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX material_inventory_legacy_location_backup_run_idx ON public.material_inventory_legacy_location_backup USING btree (run_id, table_name);
    alter table public."material_inventory_legacy_location_backup" enable row level security;
    grant all on table public."material_inventory_legacy_location_backup" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/material_inventory_legacy_location_backup

-- SQL_SOURCE_BEGIN: funkcja/apply_regrind_transfer_delta
-- apply_regrind_transfer_delta: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.apply_regrind_transfer_delta(text, text, numeric, date)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.apply_regrind_transfer_delta(p_location_id text, p_material_id text, p_delta numeric, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_location_id || ':' || p_material_id, 0));

  insert into public.daily_entries (date_key, location_id, material_id, qty, confirmed)
  values (
    p_date, p_location_id, p_material_id,
    coalesce((select qty from public.daily_entries
      where location_id = p_location_id and material_id = p_material_id and date_key < p_date
      order by date_key desc limit 1), 0), false
  ) on conflict (date_key, location_id, material_id) do nothing;

  update public.daily_entries
  set qty = qty + p_delta, updated_at = now()
  where date_key = p_date and location_id = p_location_id and material_id = p_material_id
    and qty + p_delta >= 0;
  if not found then raise exception 'INSUFFICIENT_STOCK'; end if;

  delete from public.daily_location_status where date_key = p_date and location_id = p_location_id;
end;
$function$
$definition$;
    revoke all on function public.apply_regrind_transfer_delta(text, text, numeric, date) from public, anon, authenticated;
    grant execute on function public.apply_regrind_transfer_delta(text, text, numeric, date) to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: funkcja/apply_regrind_transfer_delta

-- SQL_SOURCE_BEGIN: funkcja/create_regrind_transfer
-- create_regrind_transfer: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.create_regrind_transfer(text, text, numeric, text, text, text, text)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.create_regrind_transfer(p_kind text, p_material_id text, p_qty numeric, p_from_location_id text, p_to_location_id text, p_partner text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  movement record;
  saved public.transfers%rowtype;
  operation_at timestamptz := now();
  operation_date date := (operation_at at time zone 'Europe/Warsaw')::date;
begin
  if p_kind is null or p_kind not in ('INTERNAL', 'EXTERNAL_IN', 'EXTERNAL_OUT') then
    raise exception 'INVALID_TRANSFER_KIND';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'INVALID_QTY';
  end if;
  if not exists (select 1 from public.materials where id = p_material_id) then
    raise exception 'MATERIAL_MISSING';
  end if;
  if p_kind = 'EXTERNAL_IN' then p_from_location_id := null; end if;
  if p_kind = 'EXTERNAL_OUT' then p_to_location_id := null; end if;
  if p_kind in ('INTERNAL', 'EXTERNAL_OUT') and p_from_location_id is null then
    raise exception 'MISSING_LOCATION';
  end if;
  if p_kind in ('INTERNAL', 'EXTERNAL_IN') and p_to_location_id is null then
    raise exception 'MISSING_LOCATION';
  end if;
  if p_from_location_id = p_to_location_id then raise exception 'SAME_LOCATION'; end if;

  -- Identical lock order for creation and cancellation prevents cross-warehouse deadlocks.
  for movement in
    select * from (values (p_from_location_id, -p_qty), (p_to_location_id, p_qty)) as m(location_id, delta)
    where location_id is not null order by location_id
  loop
    if not exists (select 1 from public.locations l where l.id = movement.location_id
      and l.is_active and l.id not like 'erp-loc-%' and l.warehouse_id not like 'erp-wh-%') then
      raise exception 'MISSING_LOCATION';
    end if;
    perform public.apply_regrind_transfer_delta(movement.location_id, p_material_id, movement.delta, operation_date);
  end loop;

  insert into public.transfers (at, kind, material_id, qty, from_location_id, to_location_id, partner, note)
  values (operation_at, p_kind, p_material_id, p_qty, p_from_location_id, p_to_location_id,
    nullif(btrim(p_partner), ''), nullif(btrim(p_note), ''))
  returning * into saved;
  return to_jsonb(saved);
end;
$function$
$definition$;
    revoke all on function public.create_regrind_transfer(text, text, numeric, text, text, text, text) from public, anon, authenticated;
    grant execute on function public.create_regrind_transfer(text, text, numeric, text, text, text, text) to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: funkcja/create_regrind_transfer

-- SQL_SOURCE_BEGIN: funkcja/cancel_regrind_transfer
-- cancel_regrind_transfer: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.cancel_regrind_transfer(uuid, text)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.cancel_regrind_transfer(p_transfer_id uuid, p_cancelled_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  saved public.transfers%rowtype;
  movement record;
  operation_at timestamptz := now();
  operation_date date := (operation_at at time zone 'Europe/Warsaw')::date;
begin
  select * into saved from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
  -- Retrying the same request must never reverse stock twice.
  if saved.cancelled_at is not null then return to_jsonb(saved); end if;
  if saved.qty <= 0 or saved.qty::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'INVALID_QTY';
  end if;
  if (saved.kind in ('INTERNAL', 'EXTERNAL_OUT') and saved.from_location_id is null)
    or (saved.kind in ('INTERNAL', 'EXTERNAL_IN') and saved.to_location_id is null) then
    raise exception 'MISSING_LOCATION';
  end if;
  if saved.at > operation_at then raise exception 'TRANSFER_DATE_INVALID'; end if;

  for movement in
    select * from (values
      (case when saved.kind in ('INTERNAL', 'EXTERNAL_OUT') then saved.from_location_id end, saved.qty),
      (case when saved.kind in ('INTERNAL', 'EXTERNAL_IN') then saved.to_location_id end, -saved.qty)
    ) as m(location_id, delta)
    where location_id is not null order by location_id
  loop
    if not exists (select 1 from public.locations l where l.id = movement.location_id
      and l.id not like 'erp-loc-%' and l.warehouse_id not like 'erp-wh-%') then
      raise exception 'MISSING_LOCATION';
    end if;
    perform public.apply_regrind_transfer_delta(movement.location_id, saved.material_id, movement.delta, operation_date);
  end loop;

  update public.transfers set cancelled_at = operation_at, cancelled_by = coalesce(p_cancelled_by, '')
  where id = p_transfer_id returning * into saved;
  return to_jsonb(saved);
end;
$function$
$definition$;
    revoke all on function public.cancel_regrind_transfer(uuid, text) from public, anon, authenticated;
    grant execute on function public.cancel_regrind_transfer(uuid, text) to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: funkcja/cancel_regrind_transfer

-- Historyczna tabela halls i dawne lokalizacje pozostaja bez zmian.

notify pgrst, 'reload schema';
commit;

select 'Magazyn przemialow' as modul, 'OK'::text as wynik;
