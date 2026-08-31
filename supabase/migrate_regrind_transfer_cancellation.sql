begin;

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

notify pgrst, 'reload schema';

commit;
