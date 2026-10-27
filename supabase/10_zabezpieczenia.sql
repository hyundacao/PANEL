-- Run after modules 01-09, before deploying the security update.
-- Adds only security helpers. Does not delete or reset business data/accounts.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.replace_original_inventory_erp_snapshot(
  p_date date, p_rows jsonb, p_imported_by text, p_source_file text
) returns table(inserted integer, replaced integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_replaced integer;
  v_inserted integer;
begin
  if p_date is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_IMPORT';
  end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 100000 then
    raise exception 'INVALID_IMPORT';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('erp-snapshot:' || p_date::text, 0));
  select count(*) into v_replaced from public.original_inventory_erp_snapshots where snapshot_date = p_date;
  delete from public.original_inventory_erp_snapshots where snapshot_date = p_date;
  insert into public.original_inventory_erp_snapshots
    (id, snapshot_date, name, qty, real_qty, available_qty, unit, index_code, warehouse_code, imported_at, imported_by, source_file_name)
  select pg_catalog.gen_random_uuid(), p_date, x.name, x.available_qty, x.real_qty, x.available_qty,
    x.unit, x.index_code, x.warehouse_code, now(), p_imported_by, p_source_file
  from jsonb_to_recordset(p_rows) as x(name text, real_qty numeric, available_qty numeric, unit text, index_code text, warehouse_code text);
  get diagnostics v_inserted = row_count;
  return query select v_inserted, v_replaced;
end;
$$;
revoke all on function public.replace_original_inventory_erp_snapshot(date,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.replace_original_inventory_erp_snapshot(date,jsonb,text,text) to service_role;

create table if not exists public.security_rate_limits (
  bucket text primary key,
  attempts integer not null,
  expires_at timestamptz not null
);
alter table public.security_rate_limits enable row level security;
revoke all on public.security_rate_limits from public, anon, authenticated;
grant all on public.security_rate_limits to service_role;
create index if not exists security_rate_limits_expiry_idx on public.security_rate_limits(expires_at);

create or replace function public.consume_security_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
  v_expiry timestamptz;
begin
  if p_bucket is null or p_limit is null or p_window_seconds is null or p_bucket !~ '^[a-f0-9]{64}$' or p_limit < 1 or p_limit > 1000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'INVALID_RATE_LIMIT';
  end if;
  delete from public.security_rate_limits where expires_at < now() - interval '1 day';
  insert into public.security_rate_limits as limits(bucket, attempts, expires_at)
  values (p_bucket, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (bucket) do update set
    attempts = case when limits.expires_at <= now() then 1 else least(limits.attempts + 1, p_limit + 1) end,
    expires_at = case when limits.expires_at <= now() then now() + make_interval(secs => p_window_seconds) else limits.expires_at end
  returning attempts, expires_at into v_count, v_expiry;
  if v_count > p_limit then return greatest(1, ceil(extract(epoch from v_expiry - now()))::integer); end if;
  return 0;
end;
$$;
revoke all on function public.consume_security_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit(text,integer,integer) to service_role;

create or replace function public.revoke_session_on_password_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.password_hash is distinct from old.password_hash then
    new.active_session_id := null;
  end if;
  return new;
end;
$$;
revoke all on function public.revoke_session_on_password_change() from public, anon, authenticated;
drop trigger if exists revoke_session_on_password_change on public.app_users;
create trigger revoke_session_on_password_change before update of password_hash on public.app_users
for each row execute function public.revoke_session_on_password_change();

notify pgrst, 'reload schema';
commit;
select 'Zabezpieczenia' as modul, 'OK' as wynik;
