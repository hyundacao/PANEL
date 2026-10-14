begin;

alter table public.paint_tape_inventory_sessions
  add column if not exists erp_comparison jsonb;
alter table public.paint_tape_settlements
  add column if not exists erp_archive jsonb;

create index if not exists paint_tape_settlements_erp_date_idx
  on public.paint_tape_settlements (((production_completed_at at time zone 'Europe/Warsaw')::date))
  where production_completed_at is not null and erp_archive is null;

create or replace function public.erp_archive_material_key(p_value text)
returns text language sql immutable set search_path = public as $$
  select trim(regexp_replace(translate(lower(coalesce(p_value, '')),
    U&'\0105\0107\0119\0144\00f3\015b\017a\017c', 'acenoszz'), '\s+', ' ', 'g'));
$$;

create or replace function public.capture_paint_tape_settlement_erp(
  p_index text, p_name text, p_completed_at timestamptz
) returns jsonb language plpgsql set search_path = public as $$
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
end $$;

create or replace function public.guard_paint_tape_settlement_erp()
returns trigger language plpgsql set search_path = public as $$
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
end $$;
drop trigger if exists paint_tape_settlement_erp_guard on public.paint_tape_settlements;
create trigger paint_tape_settlement_erp_guard before insert or update on public.paint_tape_settlements
  for each row execute function public.guard_paint_tape_settlement_erp();

create index if not exists paint_tape_inventory_sessions_pending_archive_idx
  on public.paint_tape_inventory_sessions (inventory_date)
  where status = 'CLOSED' and erp_comparison is null;

-- Entry writes and closing use the same lock, so no measurement can be lost.
create or replace function public.guard_paint_tape_inventory_entry()
returns trigger language plpgsql set search_path = public as $$
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
end $$;

drop trigger if exists paint_tape_inventory_entry_guard on public.paint_tape_inventory_entries;
create trigger paint_tape_inventory_entry_guard
  before insert or update or delete on public.paint_tape_inventory_entries
  for each row execute function public.guard_paint_tape_inventory_entry();

-- Reimports and explicit deletions must not bypass protection for legacy counts.
create or replace function public.guard_original_inventory_erp_archive()
returns trigger language plpgsql set search_path = public as $$
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
end $$;
drop trigger if exists original_inventory_erp_archive_guard on public.original_inventory_erp_snapshots;
create trigger original_inventory_erp_archive_guard
  before delete on public.original_inventory_erp_snapshots
  for each row execute function public.guard_original_inventory_erp_archive();

create or replace function public.archive_paint_tape_inventory_session(
  p_session_id uuid, p_comparison jsonb, p_expected_entries jsonb,
  p_actor text, p_close boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $$
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
end $$;

create or replace function public.purge_original_inventory_erp_snapshots(p_cutoff_date date)
returns bigint language plpgsql security definer set search_path = public as $$
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
end $$;

revoke all on function public.archive_paint_tape_inventory_session(uuid, jsonb, jsonb, text, boolean)
  from public, anon, authenticated;
revoke all on function public.purge_original_inventory_erp_snapshots(date)
  from public, anon, authenticated;
grant execute on function public.archive_paint_tape_inventory_session(uuid, jsonb, jsonb, text, boolean)
  to service_role;
grant execute on function public.purge_original_inventory_erp_snapshots(date) to service_role;
revoke all on function public.capture_paint_tape_settlement_erp(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.capture_paint_tape_settlement_erp(text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;
