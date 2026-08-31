-- APKA DLA KAMILA - complete Supabase setup (warehouse-only material inventory).
-- Expected use: paste/upload this whole file into the Supabase SQL Editor for the target project and run it once as the authoritative full setup.
-- Safe after the previous failed attempt at the warehouse-only normalization do $ syntax error: earlier setup/seed statements are written to be safe to re-run.
-- This is the complete A-to-Z script, not a suffix/retry fragment and not an old setup followed by duplicate overlays; warehouse-only inventory is integrated into the schema, seed data, RLS scope, and normalization block below.
-- Warehouses are the only active operational inventory units. Legacy WTR/storage-field/location rows are preserved for data/audit and marked inactive; inventory activity is normalized onto one hidden warehouse anchor location per warehouse.
-- Safe re-run caveat: the setup uses IF EXISTS/IF NOT EXISTS/upserts/guarded DO blocks where practical. Re-running the warehouse normalization appends a new audit/report run, but it recalculates from legacy non-anchor rows only to avoid double-counting warehouse anchors.
create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;

-- =========================
-- USERS (AUTH FOR APP UI)
-- =========================
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text not null,
  password_hash text not null,
  role text not null default 'USER' check (role in ('VIEWER', 'USER', 'ADMIN', 'HEAD_ADMIN')),
  access jsonb not null default '{"admin":false,"warehouses":{}}'::jsonb,
  active_session_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login timestamptz
);

alter table if exists public.app_users
  add column if not exists active_session_id uuid;

alter table if exists public.app_users
  drop constraint if exists app_users_role_check;

alter table if exists public.app_users
  add constraint app_users_role_check
  check (role in ('VIEWER', 'USER', 'ADMIN', 'HEAD_ADMIN'));

do $$
begin
  if not exists (
    select 1
    from public.app_users
    group by lower(username)
    having count(*) > 1
  ) then
    execute $ddl$
      create unique index if not exists app_users_username_lower_idx
        on public.app_users (lower(username))
    $ddl$;
  else
    execute $ddl$
      create index if not exists app_users_username_lower_lookup_idx
        on public.app_users (lower(username))
    $ddl$;
  end if;
end $$;

create or replace function public.list_app_users()
returns table (
  id uuid,
  name text,
  username text,
  role text,
  access jsonb,
  is_active boolean,
  created_at timestamptz,
  last_login timestamptz
)
language sql
security definer
set search_path = public, extensions
as $$
  select id, name, username, role, access, is_active, created_at, last_login
  from public.app_users
  order by created_at asc;
$$;

create or replace function public.create_app_user(
  p_name text,
  p_username text,
  p_password text,
  p_role text default 'USER',
  p_access jsonb default '{"admin":false,"warehouses":{}}'::jsonb
)
returns table (
  id uuid,
  name text,
  username text,
  role text,
  access jsonb,
  is_active boolean,
  created_at timestamptz,
  last_login timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  record public.app_users;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if p_username is null or length(trim(p_username)) = 0 then
    raise exception 'USERNAME_REQUIRED' using errcode = 'P0001';
  end if;
  if p_password is null or length(trim(p_password)) = 0 then
    raise exception 'PASSWORD_REQUIRED' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.app_users as u where lower(u.username) = lower(trim(p_username))
  ) then
    raise exception 'DUPLICATE' using errcode = 'P0001';
  end if;

  insert into public.app_users (name, username, password_hash, role, access)
  values (
    trim(p_name),
    trim(p_username),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    case when p_role in ('VIEWER', 'USER', 'ADMIN', 'HEAD_ADMIN') then p_role else 'USER' end,
    coalesce(p_access, '{"admin":false,"warehouses":{}}'::jsonb)
  )
  returning * into record;

  return query
  select record.id, record.name, record.username, record.role, record.access,
         record.is_active, record.created_at, record.last_login;
end;
$$;

create or replace function public.update_app_user(
  p_id uuid,
  p_name text default null,
  p_username text default null,
  p_password text default null,
  p_role text default null,
  p_access jsonb default null,
  p_is_active boolean default null
)
returns table (
  id uuid,
  name text,
  username text,
  role text,
  access jsonb,
  is_active boolean,
  created_at timestamptz,
  last_login timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_record public.app_users%rowtype;
begin
  if p_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_name is not null and length(trim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if p_username is not null and length(trim(p_username)) = 0 then
    raise exception 'USERNAME_REQUIRED' using errcode = 'P0001';
  end if;

  if p_username is not null and exists (
    select 1 from public.app_users as u
    where u.id <> p_id and lower(u.username) = lower(trim(p_username))
  ) then
    raise exception 'DUPLICATE' using errcode = 'P0001';
  end if;

  update public.app_users as u
    set name = coalesce(nullif(trim(p_name), ''), u.name),
        username = coalesce(nullif(trim(p_username), ''), u.username),
        password_hash = case
          when p_password is null or length(trim(p_password)) = 0 then u.password_hash
          else extensions.crypt(p_password, extensions.gen_salt('bf'))
        end,
        role = case
          when p_role in ('VIEWER', 'USER', 'ADMIN', 'HEAD_ADMIN') then p_role
          else u.role
        end,
        access = coalesce(p_access, u.access),
        is_active = coalesce(p_is_active, u.is_active)
  where u.id = p_id
  returning u.* into v_record;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return query
  select v_record.id, v_record.name, v_record.username, v_record.role, v_record.access,
         v_record.is_active, v_record.created_at, v_record.last_login;
end;
$$;

create or replace function public.deactivate_app_user(p_id uuid)
returns table (
  id uuid,
  name text,
  username text,
  role text,
  access jsonb,
  is_active boolean,
  created_at timestamptz,
  last_login timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  record public.app_users;
begin
  update public.app_users
    set is_active = false
  where id = p_id
  returning * into record;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  return query
  select record.id, record.name, record.username, record.role, record.access,
         record.is_active, record.created_at, record.last_login;
end;
$$;

create or replace function public.authenticate_user(
  p_username text,
  p_password text
)
returns table (
  id uuid,
  name text,
  username text,
  role text,
  access jsonb,
  is_active boolean,
  created_at timestamptz,
  last_login timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  record public.app_users;
begin
  if p_username is null or length(trim(p_username)) = 0 then
    raise exception 'INVALID_CREDENTIALS' using errcode = 'P0001';
  end if;
  if p_password is null or length(trim(p_password)) = 0 then
    raise exception 'INVALID_CREDENTIALS' using errcode = 'P0001';
  end if;

  select * into record
  from public.app_users as u
  where lower(u.username) = lower(trim(p_username))
  limit 1;

  if not found then
    raise exception 'INVALID_CREDENTIALS' using errcode = 'P0001';
  end if;

  if record.is_active is not true then
    raise exception 'INACTIVE' using errcode = 'P0001';
  end if;

  if record.password_hash <> extensions.crypt(p_password, record.password_hash) then
    raise exception 'INVALID_CREDENTIALS' using errcode = 'P0001';
  end if;

  update public.app_users as u
    set last_login = now()
  where u.id = record.id
  returning * into record;

  return query
  select record.id, record.name, record.username, record.role, record.access,
         record.is_active, record.created_at, record.last_login;
end;
$$;

revoke all on function public.list_app_users() from public;
revoke all on function public.create_app_user(text, text, text, text, jsonb) from public;
revoke all on function public.update_app_user(uuid, text, text, text, text, jsonb, boolean) from public;
revoke all on function public.deactivate_app_user(uuid) from public;
revoke all on function public.authenticate_user(text, text) from public;

revoke all on function public.list_app_users() from anon, authenticated;
revoke all on function public.create_app_user(text, text, text, text, jsonb) from anon, authenticated;
revoke all on function public.update_app_user(uuid, text, text, text, text, jsonb, boolean) from anon, authenticated;
revoke all on function public.deactivate_app_user(uuid) from anon, authenticated;
revoke all on function public.authenticate_user(text, text) from anon, authenticated;

grant execute on function public.list_app_users() to service_role;
grant execute on function public.create_app_user(text, text, text, text, jsonb) to service_role;
grant execute on function public.update_app_user(uuid, text, text, text, text, jsonb, boolean) to service_role;
grant execute on function public.deactivate_app_user(uuid) to service_role;
grant execute on function public.authenticate_user(text, text) to service_role;

-- =========================
-- CORE TABLES
-- =========================
create table if not exists public.warehouses (
  id text primary key,
  name text not null,
  order_no integer not null default 0,
  include_in_spis boolean not null default true,
  include_in_stats boolean not null default true,
  is_active boolean not null default true
);

create table if not exists public.locations (
  id text primary key,
  warehouse_id text not null references public.warehouses(id) on delete cascade,
  name text not null,
  order_no integer not null default 0,
  type text not null check (type in ('wtr', 'pole')),
  is_active boolean not null default true
);

create table if not exists public.material_catalogs (
  id text primary key,
  name text not null,
  is_active boolean not null default true
);

do $$
begin
  if not exists (
    select 1
    from public.material_catalogs
    group by lower(name)
    having count(*) > 1
  ) then
    execute $ddl$
      create unique index if not exists material_catalogs_name_idx
        on public.material_catalogs (lower(name))
    $ddl$;
  else
    execute $ddl$
      create index if not exists material_catalogs_name_lookup_idx
        on public.material_catalogs (lower(name))
    $ddl$;
  end if;
end $$;

create table if not exists public.materials (
  id text primary key,
  code text not null default '',
  name text not null,
  catalog_id text references public.material_catalogs(id) on delete set null,
  is_active boolean not null default true
);

alter table if exists public.materials
  add column if not exists code text not null default '';

alter table if exists public.materials
  add column if not exists catalog_id text references public.material_catalogs(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from public.materials
    group by lower(code), lower(name)
    having count(*) > 1
  ) then
    execute $ddl$
      create unique index if not exists materials_code_name_idx
        on public.materials (lower(code), lower(name))
    $ddl$;
  else
    execute $ddl$
      create index if not exists materials_code_name_lookup_idx
        on public.materials (lower(code), lower(name))
    $ddl$;
  end if;
end $$;

create index if not exists materials_catalog_idx
  on public.materials (catalog_id);

create table if not exists public.daily_entries (
  date_key date not null,
  location_id text not null references public.locations(id) on delete cascade,
  material_id text not null references public.materials(id) on delete restrict,
  qty numeric not null default 0,
  confirmed boolean not null default false,
  comment text,
  updated_at timestamptz not null default now(),
  primary key (date_key, location_id, material_id)
);

create index if not exists daily_entries_location_idx on public.daily_entries (location_id);
create index if not exists daily_entries_material_idx on public.daily_entries (material_id);
create index if not exists daily_entries_date_idx on public.daily_entries (date_key);

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

create table if not exists public.daily_location_status (
  date_key date not null,
  location_id text not null references public.locations(id) on delete cascade,
  is_confirmed boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (date_key, location_id)
);

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  kind text not null check (kind in ('INTERNAL', 'EXTERNAL_IN', 'EXTERNAL_OUT')),
  material_id text not null references public.materials(id) on delete restrict,
  qty numeric not null,
  from_location_id text references public.locations(id) on delete set null,
  to_location_id text references public.locations(id) on delete set null,
  legacy_from_location_id text,
  legacy_to_location_id text,
  partner text,
  note text
);

alter table if exists public.transfers
  add column if not exists legacy_from_location_id text,
  add column if not exists legacy_to_location_id text;

create index if not exists transfers_date_idx on public.transfers (at);
create index if not exists transfers_material_idx on public.transfers (material_id);

create table if not exists public.warehouse_transfer_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by_id uuid,
  created_by_name text not null,
  document_number text not null,
  source_warehouse text,
  target_warehouse text,
  note text,
  status text not null default 'OPEN' check (status in ('OPEN', 'ISSUED', 'CLOSED')),
  closed_at timestamptz,
  closed_by_name text
);

alter table if exists public.warehouse_transfer_documents
  drop constraint if exists warehouse_transfer_documents_status_check;

alter table if exists public.warehouse_transfer_documents
  add constraint warehouse_transfer_documents_status_check
  check (status in ('OPEN', 'ISSUED', 'CLOSED'));

create index if not exists warehouse_transfer_documents_created_idx
  on public.warehouse_transfer_documents (created_at);
create index if not exists warehouse_transfer_documents_number_idx
  on public.warehouse_transfer_documents (document_number);

create table if not exists public.warehouse_transfer_document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.warehouse_transfer_documents(id) on delete cascade,
  line_no integer not null default 1,
  priority text not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  index_code text not null,
  index_code2 text,
  name text not null,
  batch text,
  location text,
  unit text not null default 'kg',
  planned_qty numeric not null check (planned_qty > 0),
  note text,
  created_at timestamptz not null default now()
);

alter table if exists public.warehouse_transfer_document_items
  add column if not exists priority text;

update public.warehouse_transfer_document_items
set priority = 'NORMAL'
where priority is null or btrim(priority) = '';

alter table if exists public.warehouse_transfer_document_items
  alter column priority set default 'NORMAL';

alter table if exists public.warehouse_transfer_document_items
  alter column priority set not null;

alter table if exists public.warehouse_transfer_document_items
  drop constraint if exists warehouse_transfer_document_items_priority_check;

alter table if exists public.warehouse_transfer_document_items
  add constraint warehouse_transfer_document_items_priority_check
  check (priority in ('LOW', 'NORMAL', 'HIGH', 'CRITICAL'));

create index if not exists warehouse_transfer_document_items_document_idx
  on public.warehouse_transfer_document_items (document_id);
create index if not exists warehouse_transfer_document_items_index_idx
  on public.warehouse_transfer_document_items (index_code);

create table if not exists public.warehouse_transfer_item_issues (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.warehouse_transfer_document_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  issuer_id uuid,
  issuer_name text not null,
  qty numeric not null check (qty > 0),
  note text
);

create index if not exists warehouse_transfer_item_issues_item_idx
  on public.warehouse_transfer_item_issues (item_id);
create index if not exists warehouse_transfer_item_issues_created_idx
  on public.warehouse_transfer_item_issues (created_at);

create table if not exists public.warehouse_transfer_item_receipts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.warehouse_transfer_document_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  receiver_id uuid,
  receiver_name text not null,
  qty numeric not null check (qty > 0),
  note text
);

create index if not exists warehouse_transfer_item_receipts_item_idx
  on public.warehouse_transfer_item_receipts (item_id);
create index if not exists warehouse_transfer_item_receipts_created_idx
  on public.warehouse_transfer_item_receipts (created_at);

create table if not exists public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  location_id text not null references public.locations(id) on delete restrict,
  material_id text not null references public.materials(id) on delete restrict,
  prev_qty numeric not null,
  next_qty numeric not null,
  note text,
  legacy_location_id text
);

alter table if exists public.inventory_adjustments
  add column if not exists legacy_location_id text;

create index if not exists inventory_adjustments_date_idx on public.inventory_adjustments (at);

create table if not exists public.mixed_materials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  qty numeric not null,
  location_id text not null references public.locations(id) on delete cascade,
  legacy_location_id text
);

alter table if exists public.mixed_materials
  add column if not exists legacy_location_id text;

create index if not exists mixed_materials_name_idx on public.mixed_materials (lower(name));
create index if not exists mixed_materials_location_idx on public.mixed_materials (location_id);

create table if not exists public.dryers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  order_no integer not null default 0,
  is_active boolean not null default true,
  material_id text
);

alter table if exists public.dryers
  drop constraint if exists dryers_material_id_fkey;

create table if not exists public.spare_parts (
  id text primary key default (gen_random_uuid()::text),
  code text not null,
  name text not null,
  unit text not null,
  qty numeric not null default 0,
  location text
);

do $$
begin
  if not exists (
    select 1
    from public.spare_parts
    group by lower(code)
    having count(*) > 1
  ) then
    execute $ddl$
      create unique index if not exists spare_parts_code_idx
        on public.spare_parts (lower(code))
    $ddl$;
  else
    execute $ddl$
      create index if not exists spare_parts_code_lookup_idx
        on public.spare_parts (lower(code))
    $ddl$;
  end if;

  if not exists (
    select 1
    from public.spare_parts
    group by lower(name)
    having count(*) > 1
  ) then
    execute $ddl$
      create unique index if not exists spare_parts_name_idx
        on public.spare_parts (lower(name))
    $ddl$;
  else
    execute $ddl$
      create index if not exists spare_parts_name_lookup_idx
        on public.spare_parts (lower(name))
    $ddl$;
  end if;
end $$;

create table if not exists public.spare_part_history (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_name text not null,
  part_id text not null references public.spare_parts(id) on delete cascade,
  part_name text not null,
  qty numeric not null,
  kind text not null check (kind in ('IN', 'OUT')),
  note text
);

create index if not exists spare_part_history_date_idx on public.spare_part_history (at);

create table if not exists public.original_inventory_entries (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  warehouse_id text not null references public.warehouses(id) on delete restrict,
  name text not null,
  qty numeric not null,
  unit text not null,
  location text,
  note text,
  user_name text not null
);

create index if not exists original_inventory_entries_date_idx on public.original_inventory_entries (at);

create table if not exists public.original_inventory_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null,
  index_code text,
  warehouse_code text,
  created_at timestamptz not null default now()
);

alter table if exists public.original_inventory_catalog
  add column if not exists index_code text;

alter table if exists public.original_inventory_catalog
  add column if not exists warehouse_code text;

update public.original_inventory_catalog
set warehouse_code =
  upper(regexp_replace(substring(index_code from '(?i)M[- ]?\d+'), '\s+', '-', 'g'))
where coalesce(trim(warehouse_code), '') = ''
  and coalesce(trim(index_code), '') <> ''
  and substring(index_code from '(?i)M[- ]?\d+') is not null;

drop index if exists original_inventory_catalog_name_idx;

do $$
begin
  if not exists (
    select 1
    from public.original_inventory_catalog
    group by lower(name), coalesce(lower(index_code), '')
    having count(*) > 1
  ) then
    execute $ddl$
      create unique index if not exists original_inventory_catalog_name_index_idx
        on public.original_inventory_catalog (
          lower(name),
          coalesce(lower(index_code), '')
        )
    $ddl$;
  else
    execute $ddl$
      create index if not exists original_inventory_catalog_name_index_lookup_idx
        on public.original_inventory_catalog (
          lower(name),
          coalesce(lower(index_code), '')
        )
    $ddl$;
  end if;
end $$;

create table if not exists public.original_inventory_erp_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  name text not null,
  real_qty numeric not null default 0,
  available_qty numeric not null default 0,
  unit text not null,
  index_code text,
  warehouse_code text,
  imported_at timestamptz not null default now(),
  imported_by text not null,
  source_file_name text
);

alter table if exists public.original_inventory_erp_snapshots
  add column if not exists index_code text;

alter table if exists public.original_inventory_erp_snapshots
  add column if not exists warehouse_code text;

alter table if exists public.original_inventory_erp_snapshots
  add column if not exists real_qty numeric;

alter table if exists public.original_inventory_erp_snapshots
  add column if not exists available_qty numeric;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'original_inventory_erp_snapshots'
      and column_name = 'qty'
  ) then
    execute $update$
      update public.original_inventory_erp_snapshots
      set
        real_qty = coalesce(real_qty, qty, 0),
        available_qty = coalesce(available_qty, qty, 0)
      where real_qty is null or available_qty is null
    $update$;
  else
    update public.original_inventory_erp_snapshots
    set
      real_qty = coalesce(real_qty, 0),
      available_qty = coalesce(available_qty, 0)
    where real_qty is null or available_qty is null;
  end if;
end $$;

alter table if exists public.original_inventory_erp_snapshots
  alter column real_qty set default 0;

alter table if exists public.original_inventory_erp_snapshots
  alter column available_qty set default 0;

alter table if exists public.original_inventory_erp_snapshots
  alter column real_qty set not null;

alter table if exists public.original_inventory_erp_snapshots
  alter column available_qty set not null;

update public.original_inventory_erp_snapshots
set warehouse_code =
  upper(regexp_replace(substring(index_code from '(?i)M[- ]?\d+'), '\s+', '-', 'g'))
where coalesce(trim(warehouse_code), '') = ''
  and coalesce(trim(index_code), '') <> ''
  and substring(index_code from '(?i)M[- ]?\d+') is not null;

create index if not exists original_inventory_erp_snapshots_date_idx
  on public.original_inventory_erp_snapshots (snapshot_date);

drop index if exists original_inventory_erp_snapshots_date_name_idx;

do $$
begin
  if not exists (
    select 1
    from public.original_inventory_erp_snapshots
    group by snapshot_date, lower(name), coalesce(lower(index_code), '')
    having count(*) > 1
  ) then
    execute $ddl$
      create unique index if not exists original_inventory_erp_snapshots_date_name_index_idx
        on public.original_inventory_erp_snapshots (
          snapshot_date,
          lower(name),
          coalesce(lower(index_code), '')
        )
    $ddl$;
  else
    execute $ddl$
      create index if not exists original_inventory_erp_snapshots_date_name_index_lookup_idx
        on public.original_inventory_erp_snapshots (
          snapshot_date,
          lower(name),
          coalesce(lower(index_code), '')
        )
    $ddl$;
  end if;
end $$;

-- =========================
-- RAPORT ZMIANOWY
-- =========================
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

create table if not exists public.raport_brakowosci_latest (
  id text primary key default 'latest',
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists raport_zmianowy_entries_item_idx
  on public.raport_zmianowy_entries (item_id);
create index if not exists raport_zmianowy_entries_created_idx
  on public.raport_zmianowy_entries (created_at);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_name text not null,
  action text not null,
  warehouse text,
  location text,
  material text,
  prev_qty numeric,
  next_qty numeric
);

create index if not exists audit_logs_date_idx on public.audit_logs (at);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  erp_warehouseman_source_warehouses text[],
  erp_dispatcher_target_locations text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from public.push_subscriptions
    group by endpoint
    having count(*) > 1
  ) then
    execute $ddl$
      create unique index if not exists push_subscriptions_endpoint_uq
        on public.push_subscriptions (endpoint)
    $ddl$;
  else
    execute $ddl$
      create index if not exists push_subscriptions_endpoint_lookup_idx
        on public.push_subscriptions (endpoint)
    $ddl$;
  end if;
end $$;

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

create index if not exists push_subscriptions_last_seen_idx
  on public.push_subscriptions (last_seen_at desc);
-- Warehouse-only inventory audit/report tables. These preserve legacy location state instead of deleting it blindly.
create table if not exists public.material_inventory_warehouse_migration_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  note text not null
);

create table if not exists public.material_inventory_warehouse_migration_report (
  run_id uuid not null references public.material_inventory_warehouse_migration_runs(id) on delete cascade,
  section text not null,
  warehouse_id text,
  material_id text,
  qty_before numeric not null default 0,
  qty_after numeric not null default 0,
  diff numeric not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists material_inventory_warehouse_migration_report_run_idx
  on public.material_inventory_warehouse_migration_report (run_id, section);

create table if not exists public.material_inventory_legacy_location_backup (
  run_id uuid not null references public.material_inventory_warehouse_migration_runs(id) on delete cascade,
  table_name text not null,
  row_data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists material_inventory_legacy_location_backup_run_idx
  on public.material_inventory_legacy_location_backup (run_id, table_name);

-- =========================
-- SECURE RLS (server only)
-- =========================
do $$
declare
  table_name text;
begin
  for table_name in
    select unnest(
      ARRAY[
        'app_users',
        'warehouses',
        'locations',
        'material_catalogs',
        'materials',
        'daily_entries',
        'daily_entry_measurements',
        'daily_location_status',
        'transfers',
        'warehouse_transfer_documents',
        'warehouse_transfer_document_items',
        'warehouse_transfer_item_issues',
        'warehouse_transfer_item_receipts',
        'inventory_adjustments',
        'mixed_materials',
        'dryers',
        'spare_parts',
        'spare_part_history',
        'original_inventory_entries',
        'original_inventory_catalog',
        'original_inventory_erp_snapshots',
        'raport_zmianowy_sessions',
        'raport_zmianowy_items',
        'raport_zmianowy_entries',
        'raport_brakowosci_latest',
        'audit_logs',
        'push_subscriptions',
        'material_inventory_warehouse_migration_runs',
        'material_inventory_warehouse_migration_report',
        'material_inventory_legacy_location_backup'
      ]::text[]
    )
  loop
    execute format('alter table if exists public.%I enable row level security', table_name);
  end loop;
end
$$;

drop policy if exists "locations_read" on public.locations;
drop policy if exists "materials_read" on public.materials;
drop policy if exists "daily_entries_read" on public.daily_entries;
drop policy if exists "daily_locations_read" on public.daily_location_status;
drop policy if exists "audit_read" on public.audit_logs;

drop policy if exists "locations_write" on public.locations;
drop policy if exists "materials_write" on public.materials;
drop policy if exists "daily_entries_write" on public.daily_entries;
drop policy if exists "daily_locations_write" on public.daily_location_status;
drop policy if exists "audit_write" on public.audit_logs;

do $$
begin
  if to_regclass('public.halls') is not null then
    execute 'drop policy if exists "halls_read" on public.halls';
    execute 'drop policy if exists "halls_write" on public.halls';
  end if;
end $$;

-- =========================
-- SEED DATA (from fixtures)
-- =========================
insert into public.warehouses (id, name, order_no, include_in_spis, include_in_stats, is_active) values
  ('hall-1', 'Hala 1', 1, true, true, true),
  ('hall-2', 'Hala 2', 2, true, true, true),
  ('hall-3', 'Hala 3', 3, true, true, true),
  ('mill-pp', 'Pomieszczenie z młynem PP', 4, true, true, true),
  ('daszek-1', 'Daszek NR 1', 4, false, false, true),
  ('daszek-2', 'Daszek NR 2', 5, false, false, true)
on conflict (id) do nothing;

insert into public.warehouses (id, name, order_no, include_in_spis, include_in_stats, is_active) values
  ('bakoma', 'Bakoma', 3, true, false, true),
  ('lakiernia', 'Lakiernia', 4, true, false, true)
on conflict (id) do update set
  name = excluded.name,
  order_no = excluded.order_no,
  include_in_spis = true,
  include_in_stats = false,
  is_active = true;

with target_warehouses as (
  select w.id, w.name
  from public.warehouses w
  where w.is_active is true
    and not w.id like 'erp-wh-%'
  union
  select w.id, w.name
  from public.locations l
  join public.warehouses w on w.id = l.warehouse_id
  where not w.id like 'erp-wh-%'
    and not l.id like 'erp-loc-%'
    and not l.id like 'warehouse-inventory-%'
    and (
      exists (select 1 from public.daily_entries de where de.location_id = l.id)
      or exists (select 1 from public.daily_entry_measurements dm where dm.location_id = l.id)
      or exists (select 1 from public.daily_location_status ds where ds.location_id = l.id)
      or exists (select 1 from public.transfers t where t.from_location_id = l.id or t.to_location_id = l.id)
      or exists (select 1 from public.inventory_adjustments a where a.location_id = l.id)
      or exists (select 1 from public.mixed_materials m where m.location_id = l.id)
    )
)
insert into public.locations (id, warehouse_id, name, order_no, type, is_active)
select
  'warehouse-inventory-' || tw.id,
  tw.id,
  tw.name,
  0,
  'pole',
  true
from target_warehouses tw
on conflict (id) do update set
  warehouse_id = excluded.warehouse_id,
  name = excluded.name,
  order_no = excluded.order_no,
  type = excluded.type,
  is_active = true;

-- Preserve any legacy WTR/storage-field/location rows already present, but keep them out of user-facing inventory workflows.
update public.locations l
set is_active = false
where not l.id like 'warehouse-inventory-%'
  and not l.id like 'erp-loc-%';
insert into public.materials (id, code, name, is_active) values
  ('mat-abs-9203', 'PRZEMIAL ABS', 'ABS 9203', true),
  ('mat-pp-310', 'PRZEMIAL PP', 'PP 310', true),
  ('mat-pp-borealis-hf700sa', 'PRZEMIAL PP', 'BOREALIS HF700SA', true),
  ('mat-pp-tatren-5046', 'PRZEMIAL PP', 'TATREN 5046', true),
  ('mat-pet-002', 'PRZEMIAL PET', 'PET 002', true),
  ('mat-pom-10', 'PRZEMIAL POM', 'POM 10', true),
  ('mat-pa6-77', 'PRZEMIAL PA6', 'PA6 77', true)
on conflict (id) do nothing;

insert into public.material_catalogs (id, name, is_active)
select
  concat('cat-', md5(lower(src.code))) as id,
  src.code as name,
  true
from (
  select min(trim(code)) as code
  from public.materials
  where code is not null and length(trim(code)) > 0
  group by lower(trim(code))
) as src
where not exists (
  select 1
  from public.material_catalogs c
  where lower(c.name) = lower(src.code)
);

update public.material_catalogs c
set is_active = true
where exists (
  select 1
  from public.materials m
  where m.code is not null
    and length(trim(m.code)) > 0
    and lower(trim(m.code)) = lower(c.name)
);

update public.materials as m
set catalog_id = c.id
from public.material_catalogs as c
where m.code is not null
  and length(trim(m.code)) > 0
  and lower(trim(m.code)) = lower(c.name)
  and m.catalog_id is distinct from c.id;

insert into public.spare_parts (id, code, name, unit, qty, location) values
  ('part-lozysko-6204', '6204', 'Lozysko 6204', 'szt', 24, 'Szafka A1'),
  ('part-pas-a24', 'A24', 'Pas klinowy A24', 'szt', 9, 'Szafka A2'),
  ('part-silownik-50', 'CYL-50', 'Silownik 50mm', 'szt', 4, 'Regal B1'),
  ('part-filtr-pp', 'FIL-PP', 'Filtr PP', 'szt', 16, 'Szafka A3'),
  ('part-czujnik-temp', 'TEMP-01', 'Czujnik temperatury', 'szt', 7, 'Regal B2')
on conflict (id) do nothing;
-- =========================
-- WAREHOUSE-ONLY INVENTORY NORMALIZATION
-- =========================
-- Converts existing legacy location-based inventory references to warehouse anchor locations.
-- Legacy rows stay in place for audit/back-reference and are not deleted.
do $$
declare
  v_run_id uuid;
begin
  insert into public.material_inventory_warehouse_migration_runs(note)
  values ('Warehouse-only material inventory migration: aggregate legacy locations into hidden warehouse anchors; no legacy rows deleted.')
  returning id into v_run_id;

  insert into public.material_inventory_legacy_location_backup(run_id, table_name, row_data)
  select v_run_id, 'locations', to_jsonb(l)
  from public.locations l
  where not l.id like 'erp-loc-%'
    and not l.id like 'warehouse-inventory-%';

  insert into public.material_inventory_legacy_location_backup(run_id, table_name, row_data)
  select v_run_id, 'daily_entries', to_jsonb(de)
  from public.daily_entries de
  join public.locations l on l.id = de.location_id
  where not l.id like 'erp-loc-%'
    and not l.id like 'warehouse-inventory-%';

  insert into public.material_inventory_legacy_location_backup(run_id, table_name, row_data)
  select v_run_id, 'daily_entry_measurements', to_jsonb(dm)
  from public.daily_entry_measurements dm
  join public.locations l on l.id = dm.location_id
  where not l.id like 'erp-loc-%'
    and not l.id like 'warehouse-inventory-%';

  insert into public.material_inventory_legacy_location_backup(run_id, table_name, row_data)
  select v_run_id, 'daily_location_status', to_jsonb(ds)
  from public.daily_location_status ds
  join public.locations l on l.id = ds.location_id
  where not l.id like 'erp-loc-%'
    and not l.id like 'warehouse-inventory-%';

  insert into public.material_inventory_legacy_location_backup(run_id, table_name, row_data)
  select v_run_id, 'transfers', to_jsonb(t)
  from public.transfers t
  where t.from_location_id is not null or t.to_location_id is not null;

  insert into public.material_inventory_legacy_location_backup(run_id, table_name, row_data)
  select v_run_id, 'inventory_adjustments', to_jsonb(a)
  from public.inventory_adjustments a;

  with target_warehouses as (
    select w.id, w.name
    from public.warehouses w
    where w.is_active is true
      and not w.id like 'erp-wh-%'
    union
    select w.id, w.name
    from public.locations l
    join public.warehouses w on w.id = l.warehouse_id
    where not w.id like 'erp-wh-%'
      and not l.id like 'erp-loc-%'
      and not l.id like 'warehouse-inventory-%'
      and (
        exists (select 1 from public.daily_entries de where de.location_id = l.id)
        or exists (select 1 from public.daily_entry_measurements dm where dm.location_id = l.id)
        or exists (select 1 from public.daily_location_status ds where ds.location_id = l.id)
        or exists (select 1 from public.transfers t where t.from_location_id = l.id or t.to_location_id = l.id)
        or exists (select 1 from public.inventory_adjustments a where a.location_id = l.id)
        or exists (select 1 from public.mixed_materials m where m.location_id = l.id)
      )
  )
  insert into public.locations(id, warehouse_id, name, order_no, type, is_active)
  select
    'warehouse-inventory-' || tw.id,
    tw.id,
    tw.name,
    0,
    'pole',
    true
  from target_warehouses tw
  on conflict (id) do update set
    warehouse_id = excluded.warehouse_id,
    name = excluded.name,
    order_no = excluded.order_no,
    type = excluded.type,
    is_active = true;

  insert into public.material_inventory_warehouse_migration_report(
    run_id, section, warehouse_id, material_id, qty_before, details
  )
  select
    v_run_id,
    'daily_entries_by_warehouse_material_before',
    l.warehouse_id,
    de.material_id,
    sum(de.qty),
    jsonb_build_object('date_count', count(distinct de.date_key))
  from public.daily_entries de
  join public.locations l on l.id = de.location_id
  join public.warehouses w on w.id = l.warehouse_id
  where not w.id like 'erp-wh-%'
    and not l.id like 'erp-loc-%'
    and not l.id like 'warehouse-inventory-%'
  group by l.warehouse_id, de.material_id;

  with aggregated as (
    select
      de.date_key,
      l.warehouse_id,
      de.material_id,
      sum(de.qty) as qty,
      bool_and(de.confirmed) as confirmed,
      string_agg(distinct nullif(trim(de.comment), ''), ' | ') as comment
    from public.daily_entries de
    join public.locations l on l.id = de.location_id
    join public.warehouses w on w.id = l.warehouse_id
    where not w.id like 'erp-wh-%'
    and not l.id like 'erp-loc-%'
    and not l.id like 'warehouse-inventory-%'
    group by de.date_key, l.warehouse_id, de.material_id
  )
  insert into public.daily_entries(date_key, location_id, material_id, qty, confirmed, comment, updated_at)
  select
    date_key,
    'warehouse-inventory-' || warehouse_id,
    material_id,
    qty,
    confirmed,
    nullif(trim(coalesce(comment, '')), ''),
    now()
  from aggregated
  on conflict (date_key, location_id, material_id) do update set
    qty = excluded.qty,
    confirmed = excluded.confirmed,
    comment = excluded.comment,
    updated_at = excluded.updated_at;

  update public.daily_entry_measurements dm
  set location_id = 'warehouse-inventory-' || l.warehouse_id
  from public.locations l
  join public.warehouses w on w.id = l.warehouse_id
  where dm.location_id = l.id
    and not w.id like 'erp-wh-%'
    and not l.id like 'erp-loc-%'
    and not l.id like 'warehouse-inventory-%'
    and dm.location_id <> 'warehouse-inventory-' || l.warehouse_id;

  insert into public.daily_location_status(date_key, location_id, is_confirmed, created_at)
  select
    ds.date_key,
    'warehouse-inventory-' || l.warehouse_id,
    bool_and(ds.is_confirmed),
    min(ds.created_at)
  from public.daily_location_status ds
  join public.locations l on l.id = ds.location_id
  join public.warehouses w on w.id = l.warehouse_id
  where not w.id like 'erp-wh-%'
    and not l.id like 'erp-loc-%'
    and not l.id like 'warehouse-inventory-%'
  group by ds.date_key, l.warehouse_id
  on conflict (date_key, location_id) do update set
    is_confirmed = excluded.is_confirmed;

  update public.transfers t
  set
    legacy_from_location_id = coalesce(t.legacy_from_location_id, t.from_location_id),
    from_location_id = 'warehouse-inventory-' || lf.warehouse_id
  from public.locations lf
  join public.warehouses wf on wf.id = lf.warehouse_id
  where t.from_location_id = lf.id
    and not wf.id like 'erp-wh-%'
    and not lf.id like 'erp-loc-%'
    and not lf.id like 'warehouse-inventory-%'
    and t.from_location_id is distinct from 'warehouse-inventory-' || lf.warehouse_id;

  update public.transfers t
  set
    legacy_to_location_id = coalesce(t.legacy_to_location_id, t.to_location_id),
    to_location_id = 'warehouse-inventory-' || lt.warehouse_id
  from public.locations lt
  join public.warehouses wt on wt.id = lt.warehouse_id
  where t.to_location_id = lt.id
    and not wt.id like 'erp-wh-%'
    and not lt.id like 'erp-loc-%'
    and not lt.id like 'warehouse-inventory-%'
    and t.to_location_id is distinct from 'warehouse-inventory-' || lt.warehouse_id;

  update public.inventory_adjustments a
  set
    legacy_location_id = coalesce(a.legacy_location_id, a.location_id),
    location_id = 'warehouse-inventory-' || l.warehouse_id
  from public.locations l
  join public.warehouses w on w.id = l.warehouse_id
  where a.location_id = l.id
    and not w.id like 'erp-wh-%'
    and not l.id like 'erp-loc-%'
    and not l.id like 'warehouse-inventory-%'
    and a.location_id is distinct from 'warehouse-inventory-' || l.warehouse_id;

  update public.mixed_materials m
  set
    legacy_location_id = coalesce(m.legacy_location_id, m.location_id),
    location_id = 'warehouse-inventory-' || l.warehouse_id
  from public.locations l
  join public.warehouses w on w.id = l.warehouse_id
  where m.location_id = l.id
    and not w.id like 'erp-wh-%'
    and not l.id like 'erp-loc-%'
    and not l.id like 'warehouse-inventory-%'
    and m.location_id is distinct from 'warehouse-inventory-' || l.warehouse_id;

  update public.locations l
  set is_active = case
    when l.id like 'warehouse-inventory-%' then true
    when l.id like 'erp-loc-%' then l.is_active
    else false
  end
  where not l.id like 'erp-loc-%';

  insert into public.material_inventory_warehouse_migration_report(
    run_id, section, warehouse_id, material_id, qty_after, details
  )
  select
    v_run_id,
    'daily_entries_by_warehouse_material_after',
    l.warehouse_id,
    de.material_id,
    sum(de.qty),
    jsonb_build_object('date_count', count(distinct de.date_key))
  from public.daily_entries de
  join public.locations l on l.id = de.location_id
  where l.id like 'warehouse-inventory-%'
  group by l.warehouse_id, de.material_id;

  insert into public.material_inventory_warehouse_migration_report(
    run_id, section, qty_before, qty_after, diff, details
  )
  select
    v_run_id,
    'global_daily_entries_total_check',
    coalesce(sum(case when section = 'daily_entries_by_warehouse_material_before' then qty_before else 0 end), 0),
    coalesce(sum(case when section = 'daily_entries_by_warehouse_material_after' then qty_after else 0 end), 0),
    coalesce(sum(case when section = 'daily_entries_by_warehouse_material_after' then qty_after else 0 end), 0) -
      coalesce(sum(case when section = 'daily_entries_by_warehouse_material_before' then qty_before else 0 end), 0),
    jsonb_build_object('expected_diff', 0)
  from public.material_inventory_warehouse_migration_report
  where run_id = v_run_id
    and section in ('daily_entries_by_warehouse_material_before', 'daily_entries_by_warehouse_material_after');

  insert into public.material_inventory_warehouse_migration_report(
    run_id, section, warehouse_id, material_id, qty_before, qty_after, diff, details
  )
  select
    v_run_id,
    'transfer_balance_by_warehouse_material',
    coalesce(src.warehouse_id, dst.warehouse_id),
    coalesce(src.material_id, dst.material_id),
    coalesce(src.qty, 0),
    coalesce(dst.qty, 0),
    coalesce(dst.qty, 0) - coalesce(src.qty, 0),
    jsonb_build_object('qty_before_out', coalesce(src.qty, 0), 'qty_after_in', coalesce(dst.qty, 0))
  from (
    select lf.warehouse_id, t.material_id, sum(t.qty) as qty
    from public.transfers t
    join public.locations lf on lf.id = t.from_location_id
    where t.from_location_id is not null
    group by lf.warehouse_id, t.material_id
  ) src
  full join (
    select lt.warehouse_id, t.material_id, sum(t.qty) as qty
    from public.transfers t
    join public.locations lt on lt.id = t.to_location_id
    where t.to_location_id is not null
    group by lt.warehouse_id, t.material_id
  ) dst
    on src.warehouse_id = dst.warehouse_id
   and src.material_id = dst.material_id;
end $$;

-- BEGIN REGRIND TRANSFER CANCELLATION

-- Regrind movements only. No schema or data changes to original inventory.
alter table public.transfers
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by text;

create index if not exists transfers_cancelled_at_idx
  on public.transfers (cancelled_at) where cancelled_at is not null;

create or replace function public.apply_regrind_transfer_delta(
  p_location_id text, p_material_id text, p_delta numeric, p_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

create or replace function public.create_regrind_transfer(
  p_kind text, p_material_id text, p_qty numeric,
  p_from_location_id text, p_to_location_id text, p_partner text, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

create or replace function public.cancel_regrind_transfer(p_transfer_id uuid, p_cancelled_by text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.apply_regrind_transfer_delta(text, text, numeric, date) from public;
revoke all on function public.create_regrind_transfer(text, text, numeric, text, text, text, text) from public;
revoke all on function public.cancel_regrind_transfer(uuid, text) from public;
grant execute on function public.create_regrind_transfer(text, text, numeric, text, text, text, text) to service_role;
grant execute on function public.cancel_regrind_transfer(uuid, text) to service_role;

-- END REGRIND TRANSFER CANCELLATION

notify pgrst, 'reload schema';


-- =========================
-- ERP ACCESS DECOUPLE (safe re-run)
-- =========================
do $$
declare
  user_row record;
  current_access jsonb;
  warehouses jsonb;
  przemialy jsonb;
  erp jsonb;
  moved_tabs text[];
  remaining_tabs text[];
  merged_erp_tabs text[];
  przemialy_admin boolean;
  erp_admin boolean;
  erp_read_only boolean;
  erp_role text;
begin
  for user_row in
    select id, coalesce(access, '{"admin":false,"warehouses":{}}'::jsonb) as access
    from public.app_users
  loop
    current_access := user_row.access;
    warehouses := coalesce(current_access -> 'warehouses', '{}'::jsonb);
    przemialy := warehouses -> 'PRZEMIALY';

    if jsonb_typeof(przemialy) <> 'object' then
      continue;
    end if;

    select coalesce(array_agg(distinct tab), '{}'::text[])
    into moved_tabs
    from jsonb_array_elements_text(coalesce(przemialy -> 'tabs', '[]'::jsonb)) as t(tab)
    where tab in (
      'erp-magazynier',
      'erp-rozdzielca',
      'erp-wypisz-dokument',
      'erp-historia-dokumentow'
    );

    if coalesce(array_length(moved_tabs, 1), 0) = 0 then
      continue;
    end if;

    select coalesce(array_agg(distinct tab), '{}'::text[])
    into remaining_tabs
    from jsonb_array_elements_text(coalesce(przemialy -> 'tabs', '[]'::jsonb)) as t(tab)
    where tab not in (
      'erp-magazynier',
      'erp-rozdzielca',
      'erp-wypisz-dokument',
      'erp-historia-dokumentow'
    );

    erp := warehouses -> 'PRZESUNIECIA_ERP';
    erp_role := coalesce(erp ->> 'role', przemialy ->> 'role', 'ROZDZIELCA');
    erp_read_only := coalesce((erp ->> 'readOnly')::boolean, (przemialy ->> 'readOnly')::boolean, false);
    erp_admin := coalesce((erp ->> 'admin')::boolean, (przemialy ->> 'admin')::boolean, false);

    select coalesce(array_agg(distinct tab), '{}'::text[])
    into merged_erp_tabs
    from (
      select tab
      from jsonb_array_elements_text(coalesce(erp -> 'tabs', '[]'::jsonb)) as t(tab)
      where tab in (
        'erp-magazynier',
        'erp-rozdzielca',
        'erp-wypisz-dokument',
        'erp-historia-dokumentow'
      )
      union all
      select unnest(moved_tabs) as tab
    ) as merged;

    warehouses := jsonb_set(
      warehouses,
      '{PRZESUNIECIA_ERP}',
      jsonb_build_object(
        'role', erp_role,
        'readOnly', erp_read_only,
        'admin', erp_admin,
        'tabs', to_jsonb(merged_erp_tabs)
      ),
      true
    );

    przemialy_admin := coalesce((przemialy ->> 'admin')::boolean, false);
    if coalesce(array_length(remaining_tabs, 1), 0) = 0 and not przemialy_admin then
      warehouses := warehouses - 'PRZEMIALY';
    else
      warehouses := jsonb_set(warehouses, '{PRZEMIALY,tabs}', to_jsonb(remaining_tabs), true);
    end if;

    update public.app_users
    set access = jsonb_set(current_access, '{warehouses}', warehouses, true)
    where id = user_row.id;
  end loop;
end
$$;

-- =========================
-- PERMISSION GROUPS
-- =========================
create table if not exists public.permission_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  access jsonb not null default '{"admin":false,"warehouses":{}}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from public.permission_groups
    group by lower(name)
    having count(*) > 1
  ) then
    execute $ddl$
      create unique index if not exists permission_groups_name_lower_idx
        on public.permission_groups (lower(name))
    $ddl$;
  else
    execute $ddl$
      create index if not exists permission_groups_name_lower_lookup_idx
        on public.permission_groups (lower(name))
    $ddl$;
  end if;
end $$;

create table if not exists public.user_permission_groups (
  user_id uuid not null references public.app_users(id) on delete cascade,
  group_id uuid not null references public.permission_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

create index if not exists user_permission_groups_user_idx
  on public.user_permission_groups (user_id);

create index if not exists user_permission_groups_group_idx
  on public.user_permission_groups (group_id);

alter table if exists public.permission_groups enable row level security;
alter table if exists public.user_permission_groups enable row level security;

with permission_group_seed(name, description, access) as (
  values
    (
      'Przemialy - operator',
      'Pelna praca operacyjna w module zarzadzania przemialami i przygotowaniem produkcji.',
      '{
        "admin": false,
        "warehouses": {
          "PRZEMIALY": {
            "role": "ROZDZIELCA",
            "readOnly": false,
            "admin": false,
            "tabs": ["dashboard", "spis", "spis-oryginalow", "przesuniecia", "raporty", "kartoteka", "wymieszane", "suszarki"]
          }
        }
      }'::jsonb
    ),
    (
      'Przemialy - podglad',
      'Podglad przemialow bez edycji.',
      '{
        "admin": false,
        "warehouses": {
          "PRZEMIALY": {
            "role": "PODGLAD",
            "readOnly": true,
            "admin": false,
            "tabs": ["dashboard", "raporty", "kartoteka", "wymieszane", "suszarki", "spis-oryginalow"]
          }
        }
      }'::jsonb
    ),
    (
      'Czesci - operator',
      'Praca operacyjna w module magazynu czesci zamiennych.',
      '{
        "admin": false,
        "warehouses": {
          "CZESCI": {
            "role": "MECHANIK",
            "readOnly": false,
            "admin": false,
            "tabs": ["pobierz", "uzupelnij", "stany"]
          }
        }
      }'::jsonb
    ),
    (
      'Raport zmianowy - operator',
      'Tworzenie i edycja wpisow raportu zmianowego.',
      '{
        "admin": false,
        "warehouses": {
          "RAPORT_ZMIANOWY": {
            "role": "ROZDZIELCA",
            "readOnly": false,
            "admin": false,
            "tabs": ["raport-zmianowy"]
          }
        }
      }'::jsonb
    ),
    (
      'ERP - administrator',
      'Pelny dostep do modulu przesuniec magazynowych ERP.',
      '{
        "admin": false,
        "warehouses": {
          "PRZESUNIECIA_ERP": {
            "role": "ROZDZIELCA",
            "readOnly": false,
            "admin": true,
            "tabs": ["erp-magazynier", "erp-rozdzielca", "erp-rozdzielca-zmianowy", "erp-wypisz-dokument", "erp-historia-dokumentow"]
          }
        }
      }'::jsonb
    ),
    (
      'ERP - rozdzielca',
      'Dashboard rozdzielcy i historia przesuniec ERP.',
      '{
        "admin": false,
        "warehouses": {
          "PRZESUNIECIA_ERP": {
            "role": "ROZDZIELCA",
            "readOnly": false,
            "admin": false,
            "tabs": ["erp-rozdzielca-zmianowy", "erp-historia-dokumentow"]
          }
        }
      }'::jsonb
    ),
    (
      'ERP - rozdzielca zmianowy',
      'Dashboard rozdzielcy zmianowego i historia przesuniec ERP.',
      '{
        "admin": false,
        "warehouses": {
          "PRZESUNIECIA_ERP": {
            "role": "ROZDZIELCA",
            "readOnly": false,
            "admin": false,
            "tabs": ["erp-rozdzielca", "erp-historia-dokumentow"]
          }
        }
      }'::jsonb
    ),
    (
      'ERP - magazynier',
      'Dashboard magazyniera i historia przesuniec ERP.',
      '{
        "admin": false,
        "warehouses": {
          "PRZESUNIECIA_ERP": {
            "role": "ROZDZIELCA",
            "readOnly": false,
            "admin": false,
            "tabs": ["erp-magazynier", "erp-historia-dokumentow"]
          }
        }
      }'::jsonb
    )
),
updated as (
  update public.permission_groups pg
  set description = seed.description,
      access = seed.access,
      is_active = true
  from permission_group_seed seed
  where lower(pg.name) = lower(seed.name)
  returning lower(pg.name) as name_key
)
insert into public.permission_groups (name, description, access, is_active)
select seed.name, seed.description, seed.access, true
from permission_group_seed seed
where not exists (
  select 1
  from updated
  where updated.name_key = lower(seed.name)
)
and not exists (
  select 1
  from public.permission_groups pg
  where lower(pg.name) = lower(seed.name)
);

notify pgrst, 'reload schema';

-- =========================
-- ERP TARGET LOCATIONS
-- =========================
begin;

create table if not exists public.erp_target_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  order_no integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from public.erp_target_locations
    group by lower(name)
    having count(*) > 1
  ) then
    execute $ddl$
      create unique index if not exists erp_target_locations_name_lower_uq
        on public.erp_target_locations (lower(name))
    $ddl$;
  else
    execute $ddl$
      create index if not exists erp_target_locations_name_lower_lookup_idx
        on public.erp_target_locations (lower(name))
    $ddl$;
  end if;
end $$;

create index if not exists erp_target_locations_active_order_idx
  on public.erp_target_locations (is_active, order_no, name);

alter table if exists public.erp_target_locations enable row level security;

with erp_target_location_seed(name, order_no, is_active) as (
  values
    ('HALA 1', 1, true),
    ('HALA 2', 2, true),
    ('HALA 3', 3, true),
    ('BAKOMA', 4, true),
    ('PACZKA', 5, true),
    ('LAKIERNIA', 6, true),
    ('INNA LOKALIZACJA', 999, true)
)
insert into public.erp_target_locations (name, order_no, is_active)
select seed.name, seed.order_no, seed.is_active
from erp_target_location_seed seed
where not exists (
  select 1
  from public.erp_target_locations existing
  where lower(existing.name) = lower(seed.name)
);

commit;

notify pgrst, 'reload schema';

alter table if exists public.original_inventory_entries
  add column if not exists source_type text,
  add column if not exists source_id text;

do $$
begin
  if not exists (
    select 1
    from public.original_inventory_entries
    where source_type is not null and source_id is not null
    group by source_type, source_id
    having count(*) > 1
  ) then
    execute $ddl$
      create unique index if not exists original_inventory_entries_source_idx
        on public.original_inventory_entries(source_type, source_id)
        where source_type is not null and source_id is not null
    $ddl$;
  else
    execute $ddl$
      create index if not exists original_inventory_entries_source_lookup_idx
        on public.original_inventory_entries(source_type, source_id)
        where source_type is not null and source_id is not null
    $ddl$;
  end if;
end $$;

create table if not exists public.original_inventory_silos (
  id uuid primary key,
  name text not null,
  chamber text not null,
  material_name text not null,
  warehouse_id text not null references public.warehouses(id) on delete restrict,
  percent_kg numeric not null default 0,
  hopper_kg numeric not null default 0,
  is_active boolean not null default true,
  order_no integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.original_inventory_silo_entries (
  id uuid primary key,
  config_id uuid not null references public.original_inventory_silos(id) on delete cascade,
  date_key text not null,
  percent numeric not null default 0,
  hopper_present boolean not null default false,
  calculated_qty numeric not null default 0,
  generated_entry_id uuid references public.original_inventory_entries(id) on delete set null,
  user_name text not null default 'nieznany',
  updated_at timestamptz not null default now(),
  unique(config_id, date_key)
);

create table if not exists public.original_inventory_grind_tasks (
  id uuid primary key,
  material_name text not null,
  target_material_name text,
  qty numeric not null default 0,
  unit text not null default 'kg',
  status text not null default 'PENDING' check (status in ('PENDING', 'DONE')),
  source_report_date text,
  created_by text not null default 'nieznany',
  created_at timestamptz not null default now(),
  completed_by text,
  completed_at timestamptz
);

alter table if exists public.original_inventory_grind_tasks
  add column if not exists target_material_name text;

create index if not exists original_inventory_grind_tasks_status_created_idx
  on public.original_inventory_grind_tasks(status, created_at desc);

alter table if exists public.original_inventory_grind_tasks enable row level security;

create table if not exists public.paint_tape_settlements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null default 'nieznany',
  order_number text,
  detail_name text not null,
  item_name text not null,
  item_index_code text,
  unit text not null default 'kg',
  start_qty numeric not null default 0 check (start_qty >= 0),
  warehouse_issued_qty numeric not null default 0 check (warehouse_issued_qty >= 0),
  end_qty numeric check (end_qty is null or end_qty >= 0),
  produced_qty numeric check (produced_qty is null or produced_qty >= 0),
  production_completed_at timestamptz,
  status text not null default 'OPEN' check (status in ('OPEN', 'DETAILS_REQUIRED', 'DONE'))
);

create index if not exists paint_tape_settlements_status_idx
  on public.paint_tape_settlements (status, created_at desc);

create index if not exists paint_tape_settlements_order_idx
  on public.paint_tape_settlements (lower(order_number));

create index if not exists paint_tape_settlements_item_idx
  on public.paint_tape_settlements (lower(item_name), lower(coalesce(item_index_code, '')));

alter table if exists public.paint_tape_settlements
  add column if not exists status text not null default 'OPEN';

alter table if exists public.paint_tape_settlements
  alter column status set default 'OPEN';

alter table if exists public.paint_tape_settlements
  drop constraint if exists paint_tape_settlements_status_check;

update public.paint_tape_settlements
set status = case
  when end_qty is null then 'OPEN'
  when produced_qty is null or produced_qty <= 0 then 'DETAILS_REQUIRED'
  else 'DONE'
end
where status is null
  or status not in ('OPEN', 'DETAILS_REQUIRED', 'DONE')
  or status is distinct from case
    when end_qty is null then 'OPEN'
    when produced_qty is null or produced_qty <= 0 then 'DETAILS_REQUIRED'
    else 'DONE'
  end;

alter table if exists public.paint_tape_settlements
  alter column status set not null;

alter table if exists public.paint_tape_settlements
  add constraint paint_tape_settlements_status_check
  check (status in ('OPEN', 'DETAILS_REQUIRED', 'DONE'));

alter table if exists public.paint_tape_settlements
  alter column order_number drop not null;

alter table if exists public.paint_tape_settlements
  add column if not exists production_completed_at timestamptz;

alter table if exists public.paint_tape_settlements
  add column if not exists accounted_at timestamptz,
  add column if not exists accounted_by text;

create table if not exists public.paint_tape_settlement_issues (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.paint_tape_settlements(id) on delete cascade,
  qty numeric not null check (qty <> 0),
  created_at timestamptz not null default now(),
  created_by text not null default 'nieznany'
);

create index if not exists paint_tape_settlement_issues_settlement_idx
  on public.paint_tape_settlement_issues (settlement_id, created_at);

insert into public.paint_tape_settlement_issues (settlement_id, qty, created_at, created_by)
select id, warehouse_issued_qty, created_at, created_by
from public.paint_tape_settlements settlement
where warehouse_issued_qty <> 0
  and not exists (
    select 1
    from public.paint_tape_settlement_issues issue
    where issue.settlement_id = settlement.id
  );

alter table if exists public.paint_tape_settlements enable row level security;
alter table if exists public.paint_tape_settlement_issues enable row level security;

notify pgrst, 'reload schema';

-- ============================================================
-- CURRENT MIGRATION: migrate_przygotowanie_produkcji.sql
-- ============================================================

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

-- ============================================================
-- CURRENT MIGRATION: migrate_paint_tape_settlements.sql
-- ============================================================

create table if not exists public.paint_tape_settlements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null default 'nieznany',
  order_number text,
  detail_name text not null,
  item_name text not null,
  item_index_code text,
  unit text not null default 'kg',
  start_qty numeric not null default 0 check (start_qty >= 0),
  warehouse_issued_qty numeric not null default 0 check (warehouse_issued_qty >= 0),
  end_qty numeric check (end_qty is null or end_qty >= 0),
  produced_qty numeric check (produced_qty is null or produced_qty >= 0),
  production_completed_at timestamptz,
  status text not null default 'OPEN' check (status in ('OPEN', 'DETAILS_REQUIRED', 'DONE'))
);

create index if not exists paint_tape_settlements_status_idx
  on public.paint_tape_settlements (status, created_at desc);

create index if not exists paint_tape_settlements_order_idx
  on public.paint_tape_settlements (lower(order_number));

create index if not exists paint_tape_settlements_item_idx
  on public.paint_tape_settlements (lower(item_name), lower(coalesce(item_index_code, '')));

alter table if exists public.paint_tape_settlements
  add column if not exists status text not null default 'OPEN';

alter table if exists public.paint_tape_settlements
  alter column status set default 'OPEN';

alter table if exists public.paint_tape_settlements
  drop constraint if exists paint_tape_settlements_status_check;

update public.paint_tape_settlements
set status = case
  when end_qty is null then 'OPEN'
  when produced_qty is null or produced_qty <= 0 then 'DETAILS_REQUIRED'
  else 'DONE'
end
where status is null
  or status not in ('OPEN', 'DETAILS_REQUIRED', 'DONE')
  or status is distinct from case
    when end_qty is null then 'OPEN'
    when produced_qty is null or produced_qty <= 0 then 'DETAILS_REQUIRED'
    else 'DONE'
  end;

alter table if exists public.paint_tape_settlements
  alter column status set not null;

alter table if exists public.paint_tape_settlements
  add constraint paint_tape_settlements_status_check
  check (status in ('OPEN', 'DETAILS_REQUIRED', 'DONE'));

alter table if exists public.paint_tape_settlements
  alter column order_number drop not null;

alter table if exists public.paint_tape_settlements
  add column if not exists production_completed_at timestamptz;

alter table if exists public.paint_tape_settlements
  add column if not exists accounted_at timestamptz,
  add column if not exists accounted_by text;

alter table if exists public.paint_tape_settlements
  add column if not exists order_note text;

alter table if exists public.paint_tape_settlements
  add column if not exists usage_check_note text;

create table if not exists public.paint_tape_technology_usages (
  index_code text primary key,
  item_name text,
  usage_per_piece numeric not null check (usage_per_piece >= 0),
  unit text not null default 'kg',
  updated_at timestamptz not null default now(),
  updated_by text not null default 'nieznany'
);

create index if not exists paint_tape_technology_usages_name_idx
  on public.paint_tape_technology_usages (lower(coalesce(item_name, '')));

create table if not exists public.paint_tape_settlement_issues (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.paint_tape_settlements(id) on delete cascade,
  qty numeric not null check (qty <> 0),
  created_at timestamptz not null default now(),
  created_by text not null default 'nieznany'
);

create index if not exists paint_tape_settlement_issues_settlement_idx
  on public.paint_tape_settlement_issues (settlement_id, created_at);

insert into public.paint_tape_settlement_issues (settlement_id, qty, created_at, created_by)
select id, warehouse_issued_qty, created_at, created_by
from public.paint_tape_settlements settlement
where warehouse_issued_qty <> 0
  and not exists (
    select 1
    from public.paint_tape_settlement_issues issue
    where issue.settlement_id = settlement.id
  );

alter table if exists public.paint_tape_settlements enable row level security;
alter table if exists public.paint_tape_settlement_issues enable row level security;
alter table if exists public.paint_tape_technology_usages enable row level security;

notify pgrst, 'reload schema';

-- ============================================================
-- CURRENT MIGRATION: migrate_paint_tape_inventory.sql
-- ============================================================

create table if not exists public.paint_tape_inventory_catalog (
  id uuid primary key default gen_random_uuid(),
  item_index text not null unique,
  item_code text,
  name text not null,
  category text not null default 'INNE',
  unit text not null default 'szt.',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text not null default 'system'
);

create index if not exists paint_tape_inventory_catalog_active_order_idx
  on public.paint_tape_inventory_catalog (is_active, sort_order, name);

create table if not exists public.paint_tape_inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  inventory_date date not null unique,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  expected_count integer not null default 0,
  checked_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by text not null default 'nieznany',
  completed_at timestamptz,
  completed_by text
);

create index if not exists paint_tape_inventory_sessions_date_idx
  on public.paint_tape_inventory_sessions (inventory_date desc);

create table if not exists public.paint_tape_inventory_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.paint_tape_inventory_sessions(id) on delete cascade,
  catalog_item_id uuid not null references public.paint_tape_inventory_catalog(id) on delete restrict,
  qty numeric not null check (qty >= 0),
  location text,
  note text,
  checked_at timestamptz not null default now(),
  checked_by text not null default 'nieznany'
);

alter table if exists public.paint_tape_inventory_entries
  add column if not exists location text;

alter table if exists public.paint_tape_inventory_entries
  drop constraint if exists paint_tape_inventory_entries_session_id_catalog_item_id_key;

create index if not exists paint_tape_inventory_entries_session_idx
  on public.paint_tape_inventory_entries (session_id, checked_at);

create index if not exists paint_tape_inventory_entries_item_idx
  on public.paint_tape_inventory_entries (session_id, catalog_item_id, checked_at);

alter table if exists public.paint_tape_inventory_catalog enable row level security;
alter table if exists public.paint_tape_inventory_sessions enable row level security;
alter table if exists public.paint_tape_inventory_entries enable row level security;

-- ============================================================
-- MATERIAL PLANNING STATE AND CONCURRENCY
-- Consolidates migrate_planowanie_zapotrzebowania.sql and
-- migrate_material_planning_versions.sql for a fresh database.
-- This section does not modify the Spis rzeczywisty schema.
-- ============================================================

create table if not exists public.material_planning_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);

alter table if exists public.material_planning_state
  add column if not exists revision bigint not null default 0;

create table if not exists public.material_planning_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text not null default ''
);

create index if not exists material_planning_events_created_at_idx
  on public.material_planning_events (created_at desc);

alter table if exists public.material_planning_state enable row level security;
alter table if exists public.material_planning_events enable row level security;

comment on table public.material_planning_state is
  'Stan osobnego modułu planowania zapotrzebowania. Dostęp wyłącznie przez autoryzowane API aplikacji.';
comment on table public.material_planning_events is
  'Techniczny dziennik zapisów modułu planowania zapotrzebowania.';

create or replace function public.save_material_planning_state(
  p_module_id text,
  p_state jsonb,
  p_expected_revision bigint,
  p_updated_by text
)
returns table(new_revision bigint, has_conflict boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_revision bigint;
  next_revision bigint;
begin
  if p_module_id is null or btrim(p_module_id) = '' then
    raise exception 'MODULE_ID_REQUIRED';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'STATE_OBJECT_REQUIRED';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'EXPECTED_REVISION_INVALID';
  end if;

  insert into public.material_planning_state (id, state, updated_at, updated_by, revision)
  values (p_module_id, '{}'::jsonb, now(), coalesce(p_updated_by, ''), 0)
  on conflict (id) do nothing;

  select revision
    into current_revision
    from public.material_planning_state
    where id = p_module_id
    for update;

  if current_revision <> p_expected_revision then
    return query select current_revision, true;
    return;
  end if;

  next_revision := current_revision + 1;
  update public.material_planning_state
    set state = p_state,
        updated_at = now(),
        updated_by = coalesce(p_updated_by, ''),
        revision = next_revision
    where id = p_module_id;

  insert into public.material_planning_events (event_type, event_data, created_by)
  values (
    'STATE_SAVED',
    jsonb_build_object(
      'revision', next_revision,
      'planDate', coalesce(p_state ->> 'selectedPlanDate', ''),
      'planName', coalesce(p_state ->> 'planName', ''),
      'planSheet', coalesce(p_state ->> 'planSheet', '')
    ),
    coalesce(p_updated_by, '')
  );

  return query select next_revision, false;
end;
$$;

revoke all on function public.save_material_planning_state(text, jsonb, bigint, text) from public;
grant execute on function public.save_material_planning_state(text, jsonb, bigint, text) to service_role;

comment on function public.save_material_planning_state(text, jsonb, bigint, text) is
  'Atomowy zapis modułu Planowanie zapotrzebowania z blokadą optymistyczną i dziennikiem zdarzeń.';

notify pgrst, 'reload schema';
