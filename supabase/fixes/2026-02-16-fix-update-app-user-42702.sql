-- Fix DB_42702 in update_app_user (ambiguous column references).
-- Run once in Supabase SQL Editor.

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
    select 1
    from public.app_users as u
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
  select
    v_record.id,
    v_record.name,
    v_record.username,
    v_record.role,
    v_record.access,
    v_record.is_active,
    v_record.created_at,
    v_record.last_login;
end;
$$;

notify pgrst, 'reload schema';
