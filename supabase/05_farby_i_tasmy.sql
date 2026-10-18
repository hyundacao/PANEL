-- 05. Farby i tasmy
-- Wklej CALY plik do SQL Editor i uruchom Run. Kolejnosc pierwszego uruchomienia: 01-09.
-- Istniejace tabele, indeksy, funkcje, RLS i uprawnienia pozostaja bez zmian.
-- Nie resetuje danych, magazynow, kont, grup, zadan, raportow ani stanow.
-- Ten modul dodatkowo instaluje uzgodniona ochrone archiwalnych porownan ERP.
-- Powtorne uruchomienie nie powiela danych. Jeden plik = jedna transakcja.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = public, extensions, pg_catalog;

-- SQL_SOURCE_BEGIN: tabela/paint_tape_settlements
-- paint_tape_settlements: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.paint_tape_settlements') is null then
    create table public."paint_tape_settlements" (
    "id" uuid default gen_random_uuid() not null,
    "created_at" timestamp with time zone default now() not null,
    "updated_at" timestamp with time zone default now() not null,
    "created_by" text default 'nieznany'::text not null,
    "order_number" text,
    "detail_name" text not null,
    "item_name" text not null,
    "item_index_code" text,
    "unit" text default 'kg'::text not null,
    "start_qty" numeric default 0 not null,
    "warehouse_issued_qty" numeric default 0 not null,
    "end_qty" numeric,
    "produced_qty" numeric,
    "production_completed_at" timestamp with time zone,
    "status" text default 'OPEN'::text not null,
    "accounted_at" timestamp with time zone,
    "accounted_by" text,
    "order_note" text,
    "usage_check_note" text,
    constraint "paint_tape_settlements_end_qty_check" CHECK (end_qty IS NULL OR end_qty >= 0::numeric),
    constraint "paint_tape_settlements_pkey" PRIMARY KEY (id),
    constraint "paint_tape_settlements_produced_qty_check" CHECK (produced_qty IS NULL OR produced_qty >= 0::numeric),
    constraint "paint_tape_settlements_start_qty_check" CHECK (start_qty >= 0::numeric),
    constraint "paint_tape_settlements_status_check" CHECK (status = ANY (ARRAY['OPEN'::text, 'DETAILS_REQUIRED'::text, 'DONE'::text])),
    constraint "paint_tape_settlements_warehouse_issued_qty_check" CHECK (warehouse_issued_qty >= 0::numeric)
    );
    CREATE INDEX paint_tape_settlements_item_idx ON public.paint_tape_settlements USING btree (lower(item_name), lower(COALESCE(item_index_code, ''::text)));
    CREATE INDEX paint_tape_settlements_order_idx ON public.paint_tape_settlements USING btree (lower(order_number));
    CREATE INDEX paint_tape_settlements_status_idx ON public.paint_tape_settlements USING btree (status, created_at DESC);
    alter table public."paint_tape_settlements" enable row level security;
    grant all on table public."paint_tape_settlements" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/paint_tape_settlements

-- SQL_SOURCE_BEGIN: tabela/paint_tape_settlement_issues
-- paint_tape_settlement_issues: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.paint_tape_settlement_issues') is null then
    create table public."paint_tape_settlement_issues" (
    "id" uuid default gen_random_uuid() not null,
    "settlement_id" uuid not null,
    "qty" numeric not null,
    "created_at" timestamp with time zone default now() not null,
    "created_by" text default 'nieznany'::text not null,
    constraint "paint_tape_settlement_issues_pkey" PRIMARY KEY (id),
    constraint "paint_tape_settlement_issues_qty_check" CHECK (qty <> 0::numeric),
    constraint "paint_tape_settlement_issues_settlement_id_fkey" FOREIGN KEY (settlement_id) REFERENCES paint_tape_settlements(id) ON DELETE CASCADE
    );
    CREATE INDEX paint_tape_settlement_issues_settlement_idx ON public.paint_tape_settlement_issues USING btree (settlement_id, created_at);
    alter table public."paint_tape_settlement_issues" enable row level security;
    grant all on table public."paint_tape_settlement_issues" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/paint_tape_settlement_issues

-- SQL_SOURCE_BEGIN: tabela/paint_tape_technology_usages
-- paint_tape_technology_usages: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.paint_tape_technology_usages') is null then
    create table public."paint_tape_technology_usages" (
    "index_code" text not null,
    "item_name" text,
    "usage_per_piece" numeric not null,
    "unit" text default 'kg'::text not null,
    "updated_at" timestamp with time zone default now() not null,
    "updated_by" text default 'nieznany'::text not null,
    constraint "paint_tape_technology_usages_pkey" PRIMARY KEY (index_code),
    constraint "paint_tape_technology_usages_usage_per_piece_check" CHECK (usage_per_piece >= 0::numeric)
    );
    CREATE INDEX paint_tape_technology_usages_name_idx ON public.paint_tape_technology_usages USING btree (lower(COALESCE(item_name, ''::text)));
    alter table public."paint_tape_technology_usages" enable row level security;
    grant all on table public."paint_tape_technology_usages" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/paint_tape_technology_usages

-- SQL_SOURCE_BEGIN: tabela/paint_tape_inventory_catalog
-- paint_tape_inventory_catalog: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.paint_tape_inventory_catalog') is null then
    create table public."paint_tape_inventory_catalog" (
    "id" uuid default gen_random_uuid() not null,
    "item_index" text not null,
    "item_code" text,
    "name" text not null,
    "category" text default 'INNE'::text not null,
    "unit" text default 'szt.'::text not null,
    "sort_order" integer default 0 not null,
    "is_active" boolean default true not null,
    "created_at" timestamp with time zone default now() not null,
    "created_by" text default 'system'::text not null,
    constraint "paint_tape_inventory_catalog_item_index_key" UNIQUE (item_index),
    constraint "paint_tape_inventory_catalog_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX paint_tape_inventory_catalog_active_order_idx ON public.paint_tape_inventory_catalog USING btree (is_active, sort_order, name);
    alter table public."paint_tape_inventory_catalog" enable row level security;
    grant all on table public."paint_tape_inventory_catalog" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/paint_tape_inventory_catalog

-- SQL_SOURCE_BEGIN: tabela/paint_tape_inventory_sessions
-- paint_tape_inventory_sessions: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.paint_tape_inventory_sessions') is null then
    create table public."paint_tape_inventory_sessions" (
    "id" uuid default gen_random_uuid() not null,
    "inventory_date" date not null,
    "status" text default 'OPEN'::text not null,
    "expected_count" integer default 0 not null,
    "checked_count" integer default 0 not null,
    "created_at" timestamp with time zone default now() not null,
    "created_by" text default 'nieznany'::text not null,
    "completed_at" timestamp with time zone,
    "completed_by" text,
    constraint "paint_tape_inventory_sessions_inventory_date_key" UNIQUE (inventory_date),
    constraint "paint_tape_inventory_sessions_pkey" PRIMARY KEY (id),
    constraint "paint_tape_inventory_sessions_status_check" CHECK (status = ANY (ARRAY['OPEN'::text, 'CLOSED'::text]))
    );
    CREATE INDEX paint_tape_inventory_sessions_date_idx ON public.paint_tape_inventory_sessions USING btree (inventory_date DESC);
    alter table public."paint_tape_inventory_sessions" enable row level security;
    grant all on table public."paint_tape_inventory_sessions" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/paint_tape_inventory_sessions

-- SQL_SOURCE_BEGIN: tabela/paint_tape_inventory_entries
-- paint_tape_inventory_entries: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.paint_tape_inventory_entries') is null then
    create table public."paint_tape_inventory_entries" (
    "id" uuid default gen_random_uuid() not null,
    "session_id" uuid not null,
    "catalog_item_id" uuid not null,
    "qty" numeric not null,
    "location" text,
    "note" text,
    "checked_at" timestamp with time zone default now() not null,
    "checked_by" text default 'nieznany'::text not null,
    constraint "paint_tape_inventory_entries_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES paint_tape_inventory_catalog(id) ON DELETE RESTRICT,
    constraint "paint_tape_inventory_entries_pkey" PRIMARY KEY (id),
    constraint "paint_tape_inventory_entries_qty_check" CHECK (qty >= 0::numeric),
    constraint "paint_tape_inventory_entries_session_id_fkey" FOREIGN KEY (session_id) REFERENCES paint_tape_inventory_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX paint_tape_inventory_entries_item_idx ON public.paint_tape_inventory_entries USING btree (session_id, catalog_item_id, checked_at);
    CREATE INDEX paint_tape_inventory_entries_session_idx ON public.paint_tape_inventory_entries USING btree (session_id, checked_at);
    alter table public."paint_tape_inventory_entries" enable row level security;
    grant all on table public."paint_tape_inventory_entries" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/paint_tape_inventory_entries

-- SQL_SOURCE_BEGIN: migrate_paint_tape_inventory_archive.sql
alter table public.paint_tape_inventory_sessions add column if not exists erp_comparison jsonb;
alter table public.paint_tape_settlements add column if not exists erp_archive jsonb;

-- erp_archive_material_key: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.erp_archive_material_key(text)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.erp_archive_material_key(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select trim(regexp_replace(translate(lower(coalesce(p_value, '')),
    U&'\0105\0107\0119\0144\00f3\015b\017a\017c', 'acenoszz'), '\s+', ' ', 'g'));
$function$
$definition$;
    revoke all on function public.erp_archive_material_key(text) from public, anon, authenticated;
    grant execute on function public.erp_archive_material_key(text) to service_role;
  end if;
end
$install$;

-- capture_paint_tape_settlement_erp: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.capture_paint_tape_settlement_erp(text, text, timestamp with time zone)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.capture_paint_tape_settlement_erp(p_index text, p_name text, p_completed_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_date date := (p_completed_at at time zone 'Europe/Warsaw')::date;
  v_entry jsonb;
begin
  select to_jsonb(e) into v_entry from public.original_inventory_erp_snapshots e
    where e.snapshot_date = v_date and (
      (nullif(trim(p_index), '') is not null and public.erp_archive_material_key(e.index_code) = public.erp_archive_material_key(p_index))
      or public.erp_archive_material_key(e.name) = public.erp_archive_material_key(p_name)
    ) order by (nullif(trim(p_index), '') is not null and public.erp_archive_material_key(e.index_code) = public.erp_archive_material_key(p_index)) desc,
      e.name desc, e.id desc limit 1;
  return jsonb_build_object('date', v_date, 'entry', v_entry);
end $function$
$definition$;
    revoke all on function public.capture_paint_tape_settlement_erp(text, text, timestamp with time zone) from public, anon, authenticated;
    grant execute on function public.capture_paint_tape_settlement_erp(text, text, timestamp with time zone) to service_role;
  end if;
end
$install$;

-- guard_paint_tape_settlement_erp: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.guard_paint_tape_settlement_erp()') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.guard_paint_tape_settlement_erp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.production_completed_at is null then new.erp_archive := null; return new; end if;
  if tg_op = 'UPDATE' and old.erp_archive is not null
    and old.erp_archive->>'date' = (new.production_completed_at at time zone 'Europe/Warsaw')::date::text
    and old.item_name is not distinct from new.item_name
    and old.item_index_code is not distinct from new.item_index_code then
    new.erp_archive := old.erp_archive;
  else
    new.erp_archive := public.capture_paint_tape_settlement_erp(new.item_index_code, new.item_name, new.production_completed_at);
  end if;
  return new;
end $function$
$definition$;
    revoke all on function public.guard_paint_tape_settlement_erp() from public, anon, authenticated;
    grant execute on function public.guard_paint_tape_settlement_erp() to service_role;
  end if;
end
$install$;

-- guard_paint_tape_inventory_entry: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.guard_paint_tape_inventory_entry()') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.guard_paint_tape_inventory_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_session_id uuid;
begin
  v_session_id := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  select status into v_status from public.paint_tape_inventory_sessions
    where id = v_session_id for update;
  if v_status = 'CLOSED' then raise exception 'INVENTORY_SESSION_CLOSED'; end if;
  if tg_op = 'UPDATE' and old.session_id <> new.session_id then
    raise exception 'INVENTORY_SESSION_CHANGE_FORBIDDEN';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $function$
$definition$;
    revoke all on function public.guard_paint_tape_inventory_entry() from public, anon, authenticated;
    grant execute on function public.guard_paint_tape_inventory_entry() to service_role;
  end if;
end
$install$;

-- guard_original_inventory_erp_archive: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.guard_original_inventory_erp_archive()') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.guard_original_inventory_erp_archive()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_comparison jsonb;
begin
  select status, erp_comparison into v_status, v_comparison
    from public.paint_tape_inventory_sessions where inventory_date = old.snapshot_date for update;
  if v_status = 'CLOSED' and v_comparison is null then
    raise exception 'ERP_SNAPSHOT_ARCHIVE_REQUIRED';
  end if;
  if v_status = 'OPEN' and current_setting('app.erp_retention', true) = 'on' then
    raise exception 'ERP_SNAPSHOT_IN_USE';
  end if;
  -- Preserve legacy settlement comparisons before the first row of a day is deleted.
  update public.paint_tape_settlements set erp_archive = public.capture_paint_tape_settlement_erp(
    item_index_code, item_name, production_completed_at
  ) where erp_archive is null and (production_completed_at at time zone 'Europe/Warsaw')::date = old.snapshot_date;
  return old;
end $function$
$definition$;
    revoke all on function public.guard_original_inventory_erp_archive() from public, anon, authenticated;
    grant execute on function public.guard_original_inventory_erp_archive() to service_role;
  end if;
end
$install$;

-- archive_paint_tape_inventory_session: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.archive_paint_tape_inventory_session(uuid, jsonb, jsonb, text, boolean)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.archive_paint_tape_inventory_session(p_session_id uuid, p_comparison jsonb, p_expected_entries jsonb, p_actor text, p_close boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session public.paint_tape_inventory_sessions;
  v_entries jsonb;
begin
  select * into v_session from public.paint_tape_inventory_sessions
    where id = p_session_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_session.status = 'CLOSED' and v_session.erp_comparison is not null then
    return to_jsonb(v_session);
  end if;
  if not p_close and v_session.status <> 'CLOSED' then return to_jsonb(v_session); end if;
  if p_comparison is null or p_comparison->>'version' is distinct from '1'
    or p_comparison->>'inventoryDate' is distinct from v_session.inventory_date::text
    or jsonb_typeof(p_comparison->'rows') is distinct from 'array' then
    raise exception 'INVENTORY_ARCHIVE_INVALID';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'catalog_item_id', catalog_item_id, 'qty', qty
  ) order by id), '[]'::jsonb) into v_entries
    from public.paint_tape_inventory_entries where session_id = p_session_id;
  if v_entries is distinct from p_expected_entries then raise exception 'INVENTORY_ARCHIVE_CONFLICT'; end if;
  if exists (
    select 1 from (
      select catalog_item_id, sum(qty) qty from public.paint_tape_inventory_entries
      where session_id = p_session_id group by catalog_item_id
    ) e left join jsonb_array_elements(p_comparison->'rows') r
      on r->'item'->>'id' = e.catalog_item_id::text
    where r is null or (r->>'physicalQty')::numeric is distinct from e.qty
  ) then raise exception 'INVENTORY_ARCHIVE_INVALID'; end if;

  update public.paint_tape_inventory_sessions set
    erp_comparison = p_comparison,
    status = 'CLOSED',
    expected_count = jsonb_array_length(p_comparison->'rows'),
    checked_count = (select count(distinct catalog_item_id)
      from public.paint_tape_inventory_entries where session_id = p_session_id),
    completed_at = case when status = 'CLOSED' then completed_at else now() end,
    completed_by = case when status = 'CLOSED' then completed_by else p_actor end
    where id = p_session_id returning * into v_session;
  return to_jsonb(v_session);
end $function$
$definition$;
    revoke all on function public.archive_paint_tape_inventory_session(uuid, jsonb, jsonb, text, boolean) from public, anon, authenticated;
    grant execute on function public.archive_paint_tape_inventory_session(uuid, jsonb, jsonb, text, boolean) to service_role;
  end if;
end
$install$;

-- purge_original_inventory_erp_snapshots: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.purge_original_inventory_erp_snapshots(date)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.purge_original_inventory_erp_snapshots(p_cutoff_date date)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deleted bigint;
begin
  perform set_config('app.erp_retention', 'on', true);
  -- Bounded cleanup; unfinished or not-yet-archived counts protect the whole day.
  with removable_dates as (
    select distinct e.snapshot_date from public.original_inventory_erp_snapshots e
    where e.snapshot_date < least(p_cutoff_date, (now() at time zone 'Europe/Warsaw')::date - 90)
      and not exists (
        select 1 from public.paint_tape_inventory_sessions s
        where s.inventory_date = e.snapshot_date
          and (s.status <> 'CLOSED' or s.erp_comparison is null)
      )
    order by e.snapshot_date limit 5
  ), deleted as (
    delete from public.original_inventory_erp_snapshots e using removable_dates d
    where e.snapshot_date = d.snapshot_date returning e.id
  ) select count(*) into v_deleted from deleted;
  return v_deleted;
end $function$
$definition$;
    revoke all on function public.purge_original_inventory_erp_snapshots(date) from public, anon, authenticated;
    grant execute on function public.purge_original_inventory_erp_snapshots(date) to service_role;
  end if;
end
$install$;

CREATE INDEX IF NOT EXISTS paint_tape_inventory_sessions_pending_archive_idx ON public.paint_tape_inventory_sessions USING btree (inventory_date) WHERE ((status = 'CLOSED'::text) AND (erp_comparison IS NULL));

CREATE INDEX IF NOT EXISTS paint_tape_settlements_erp_date_idx ON public.paint_tape_settlements USING btree ((((production_completed_at AT TIME ZONE 'Europe/Warsaw'::text))::date)) WHERE ((production_completed_at IS NOT NULL) AND (erp_archive IS NULL));

do $install$
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.original_inventory_erp_snapshots'::regclass and tgname='original_inventory_erp_archive_guard') then
    CREATE TRIGGER original_inventory_erp_archive_guard BEFORE DELETE ON original_inventory_erp_snapshots FOR EACH ROW EXECUTE FUNCTION guard_original_inventory_erp_archive();
  end if;
end
$install$;

do $install$
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.paint_tape_inventory_entries'::regclass and tgname='paint_tape_inventory_entry_guard') then
    CREATE TRIGGER paint_tape_inventory_entry_guard BEFORE INSERT OR DELETE OR UPDATE ON paint_tape_inventory_entries FOR EACH ROW EXECUTE FUNCTION guard_paint_tape_inventory_entry();
  end if;
end
$install$;

do $install$
begin
  if not exists (select 1 from pg_trigger where tgrelid='public.paint_tape_settlements'::regclass and tgname='paint_tape_settlement_erp_guard') then
    CREATE TRIGGER paint_tape_settlement_erp_guard BEFORE INSERT OR UPDATE ON paint_tape_settlements FOR EACH ROW EXECUTE FUNCTION guard_paint_tape_settlement_erp();
  end if;
end
$install$;


-- SQL_SOURCE_END: migrate_paint_tape_inventory_archive.sql

notify pgrst, 'reload schema';
commit;

select 'Farby i tasmy' as modul, 'OK'::text as wynik;
