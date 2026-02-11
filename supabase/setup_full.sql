-- Full Supabase setup for the app (schema + auth users + secure RLS + seed data).
-- Paste into Supabase SQL Editor and run once. Safe to re-run.

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

create unique index if not exists app_users_username_lower_idx
  on public.app_users (lower(username));

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
  record public.app_users;
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

  update public.app_users
    set name = coalesce(nullif(trim(p_name), ''), name),
        username = coalesce(nullif(trim(p_username), ''), username),
        password_hash = case
          when p_password is null or length(trim(p_password)) = 0 then password_hash
          else extensions.crypt(p_password, extensions.gen_salt('bf'))
        end,
        role = case
          when p_role in ('VIEWER', 'USER', 'ADMIN', 'HEAD_ADMIN') then p_role
          else role
        end,
        access = coalesce(p_access, access),
        is_active = coalesce(p_is_active, is_active)
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

create unique index if not exists material_catalogs_name_idx
  on public.material_catalogs (lower(name));

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

create unique index if not exists materials_code_name_idx
  on public.materials (lower(code), lower(name));

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
  partner text,
  note text
);

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
  note text
);

create index if not exists inventory_adjustments_date_idx on public.inventory_adjustments (at);

create table if not exists public.mixed_materials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  qty numeric not null,
  location_id text not null references public.locations(id) on delete cascade
);

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

create unique index if not exists spare_parts_code_idx on public.spare_parts (lower(code));
create unique index if not exists spare_parts_name_idx on public.spare_parts (lower(name));

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
  created_at timestamptz not null default now()
);

create unique index if not exists original_inventory_catalog_name_idx
  on public.original_inventory_catalog (lower(name));

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create unique index if not exists push_subscriptions_endpoint_uq
  on public.push_subscriptions (endpoint);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

create index if not exists push_subscriptions_last_seen_idx
  on public.push_subscriptions (last_seen_at desc);

-- =========================
-- SECURE RLS (server only)
-- =========================
alter table if exists public.app_users enable row level security;
alter table if exists public.warehouses enable row level security;
alter table if exists public.locations enable row level security;
alter table if exists public.material_catalogs enable row level security;
alter table if exists public.materials enable row level security;
alter table if exists public.daily_entries enable row level security;
alter table if exists public.daily_location_status enable row level security;
alter table if exists public.transfers enable row level security;
alter table if exists public.warehouse_transfer_documents enable row level security;
alter table if exists public.warehouse_transfer_document_items enable row level security;
alter table if exists public.warehouse_transfer_item_issues enable row level security;
alter table if exists public.warehouse_transfer_item_receipts enable row level security;
alter table if exists public.inventory_adjustments enable row level security;
alter table if exists public.mixed_materials enable row level security;
alter table if exists public.dryers enable row level security;
alter table if exists public.spare_parts enable row level security;
alter table if exists public.spare_part_history enable row level security;
alter table if exists public.original_inventory_entries enable row level security;
alter table if exists public.original_inventory_catalog enable row level security;
alter table if exists public.raport_zmianowy_sessions enable row level security;
alter table if exists public.raport_zmianowy_items enable row level security;
alter table if exists public.raport_zmianowy_entries enable row level security;
alter table if exists public.audit_logs enable row level security;
alter table if exists public.push_subscriptions enable row level security;

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
  ('daszek-1', 'Daszek NR 1', 4, false, false, true),
  ('daszek-2', 'Daszek NR 2', 5, false, false, true)
on conflict (id) do nothing;

insert into public.locations (id, warehouse_id, name, order_no, type, is_active)
select concat('hall-1-wtr-', gs), 'hall-1', concat('WTR ', gs), gs, 'wtr', true
from generate_series(1, 28) as gs
on conflict (id) do nothing;

insert into public.locations (id, warehouse_id, name, order_no, type, is_active) values
  ('hall-1-pole-centralny', 'hall-1', 'Centralny zasyp', 100, 'pole', true)
on conflict (id) do nothing;

insert into public.locations (id, warehouse_id, name, order_no, type, is_active)
select concat('hall-2-wtr-', gs), 'hall-2', concat('WTR ', gs), gs, 'wtr', true
from generate_series(29, 52) as gs
on conflict (id) do nothing;

insert into public.locations (id, warehouse_id, name, order_no, type, is_active) values
  ('hall-2-pole-maguire', 'hall-2', 'Pole odkladcze Maguire', 100, 'pole', true),
  ('hall-2-pole-centralny', 'hall-2', 'Centralny zasyp', 101, 'pole', true)
on conflict (id) do nothing;

insert into public.locations (id, warehouse_id, name, order_no, type, is_active)
select concat('hall-3-wtr-', gs), 'hall-3', concat('WTR ', gs), gs, 'wtr', true
from generate_series(53, 60) as gs
on conflict (id) do nothing;

insert into public.locations (id, warehouse_id, name, order_no, type, is_active) values
  ('hall-3-pole-centralny', 'hall-3', 'Centralny zasyp', 100, 'pole', true),
  ('daszek-1-pole', 'daszek-1', 'Pole odkladcze', 1, 'pole', true),
  ('daszek-2-pole', 'daszek-2', 'Pole odkladcze', 1, 'pole', true)
on conflict (id) do nothing;

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
select concat('cat-', md5(lower(code))) as id, code as name, true
from public.materials
group by code
on conflict (id) do update
set name = excluded.name;

update public.materials as m
set catalog_id = c.id
from public.material_catalogs as c
where lower(m.code) = lower(c.name)
  and m.catalog_id is null;

insert into public.spare_parts (id, code, name, unit, qty, location) values
  ('part-lozysko-6204', '6204', 'Lozysko 6204', 'szt', 24, 'Szafka A1'),
  ('part-pas-a24', 'A24', 'Pas klinowy A24', 'szt', 9, 'Szafka A2'),
  ('part-silownik-50', 'CYL-50', 'Silownik 50mm', 'szt', 4, 'Regal B1'),
  ('part-filtr-pp', 'FIL-PP', 'Filtr PP', 'szt', 16, 'Szafka A3'),
  ('part-czujnik-temp', 'TEMP-01', 'Czujnik temperatury', 'szt', 7, 'Regal B2')
on conflict (id) do nothing;

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
