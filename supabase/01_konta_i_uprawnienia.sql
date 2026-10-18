-- 01. Konta i uprawnienia
-- Wklej CALY plik do SQL Editor i uruchom Run. Kolejnosc pierwszego uruchomienia: 01-09.
-- Istniejace tabele, indeksy, funkcje, RLS i uprawnienia pozostaja bez zmian.
-- Nie resetuje danych, magazynow, kont, grup, zadan, raportow ani stanow.
-- Powtorne uruchomienie nie powiela danych. Jeden plik = jedna transakcja.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = public, extensions, pg_catalog;

create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;

-- SQL_SOURCE_BEGIN: tabela/app_users
-- app_users: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.app_users') is null then
    create table public."app_users" (
    "id" uuid default gen_random_uuid() not null,
    "name" text not null,
    "username" text not null,
    "password_hash" text not null,
    "role" text default 'USER'::text not null,
    "access" jsonb default '{"admin": false, "warehouses": {}}'::jsonb not null,
    "active_session_id" uuid,
    "is_active" boolean default true not null,
    "created_at" timestamp with time zone default now() not null,
    "last_login" timestamp with time zone,
    constraint "app_users_pkey" PRIMARY KEY (id),
    constraint "app_users_role_check" CHECK (role = ANY (ARRAY['VIEWER'::text, 'USER'::text, 'ADMIN'::text, 'HEAD_ADMIN'::text]))
    );
    CREATE UNIQUE INDEX app_users_username_lower_idx ON public.app_users USING btree (lower(username));
    alter table public."app_users" enable row level security;
    grant all on table public."app_users" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/app_users

-- SQL_SOURCE_BEGIN: tabela/permission_groups
-- permission_groups: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.permission_groups') is null then
    create table public."permission_groups" (
    "id" uuid default gen_random_uuid() not null,
    "name" text not null,
    "description" text,
    "access" jsonb default '{"admin": false, "warehouses": {}}'::jsonb not null,
    "is_active" boolean default true not null,
    "created_at" timestamp with time zone default now() not null,
    constraint "permission_groups_pkey" PRIMARY KEY (id)
    );
    CREATE UNIQUE INDEX permission_groups_name_lower_idx ON public.permission_groups USING btree (lower(name));
    alter table public."permission_groups" enable row level security;
    grant all on table public."permission_groups" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/permission_groups

-- SQL_SOURCE_BEGIN: tabela/user_permission_groups
-- user_permission_groups: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.user_permission_groups') is null then
    create table public."user_permission_groups" (
    "user_id" uuid not null,
    "group_id" uuid not null,
    "created_at" timestamp with time zone default now() not null,
    constraint "user_permission_groups_group_id_fkey" FOREIGN KEY (group_id) REFERENCES permission_groups(id) ON DELETE CASCADE,
    constraint "user_permission_groups_pkey" PRIMARY KEY (user_id, group_id),
    constraint "user_permission_groups_user_id_fkey" FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
    );
    CREATE INDEX user_permission_groups_group_idx ON public.user_permission_groups USING btree (group_id);
    CREATE INDEX user_permission_groups_user_idx ON public.user_permission_groups USING btree (user_id);
    alter table public."user_permission_groups" enable row level security;
    grant all on table public."user_permission_groups" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/user_permission_groups

-- SQL_SOURCE_BEGIN: funkcja/list_app_users
-- list_app_users: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.list_app_users()') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.list_app_users()
 RETURNS TABLE(id uuid, name text, username text, role text, access jsonb, is_active boolean, created_at timestamp with time zone, last_login timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select id, name, username, role, access, is_active, created_at, last_login
  from public.app_users
  order by created_at asc;
$function$
$definition$;
    revoke all on function public.list_app_users() from public, anon, authenticated;
    grant execute on function public.list_app_users() to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: funkcja/list_app_users

-- SQL_SOURCE_BEGIN: funkcja/create_app_user
-- create_app_user: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.create_app_user(text, text, text, text, jsonb)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.create_app_user(p_name text, p_username text, p_password text, p_role text DEFAULT 'USER'::text, p_access jsonb DEFAULT '{"admin": false, "warehouses": {}}'::jsonb)
 RETURNS TABLE(id uuid, name text, username text, role text, access jsonb, is_active boolean, created_at timestamp with time zone, last_login timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
$definition$;
    revoke all on function public.create_app_user(text, text, text, text, jsonb) from public, anon, authenticated;
    grant execute on function public.create_app_user(text, text, text, text, jsonb) to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: funkcja/create_app_user

-- SQL_SOURCE_BEGIN: funkcja/update_app_user
-- update_app_user: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.update_app_user(uuid, text, text, text, text, jsonb, boolean)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.update_app_user(p_id uuid, p_name text DEFAULT NULL::text, p_username text DEFAULT NULL::text, p_password text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_access jsonb DEFAULT NULL::jsonb, p_is_active boolean DEFAULT NULL::boolean)
 RETURNS TABLE(id uuid, name text, username text, role text, access jsonb, is_active boolean, created_at timestamp with time zone, last_login timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
$definition$;
    revoke all on function public.update_app_user(uuid, text, text, text, text, jsonb, boolean) from public, anon, authenticated;
    grant execute on function public.update_app_user(uuid, text, text, text, text, jsonb, boolean) to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: funkcja/update_app_user

-- SQL_SOURCE_BEGIN: funkcja/deactivate_app_user
-- deactivate_app_user: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.deactivate_app_user(uuid)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.deactivate_app_user(p_id uuid)
 RETURNS TABLE(id uuid, name text, username text, role text, access jsonb, is_active boolean, created_at timestamp with time zone, last_login timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
$definition$;
    revoke all on function public.deactivate_app_user(uuid) from public, anon, authenticated;
    grant execute on function public.deactivate_app_user(uuid) to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: funkcja/deactivate_app_user

-- SQL_SOURCE_BEGIN: funkcja/authenticate_user
-- authenticate_user: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.authenticate_user(text, text)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.authenticate_user(p_username text, p_password text)
 RETURNS TABLE(id uuid, name text, username text, role text, access jsonb, is_active boolean, created_at timestamp with time zone, last_login timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
$definition$;
    revoke all on function public.authenticate_user(text, text) from public, anon, authenticated;
    grant execute on function public.authenticate_user(text, text) to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: funkcja/authenticate_user

notify pgrst, 'reload schema';
commit;

select 'Konta i uprawnienia' as modul, 'OK'::text as wynik;
