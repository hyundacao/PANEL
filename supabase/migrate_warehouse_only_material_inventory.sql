begin;

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

create table if not exists public.material_inventory_legacy_location_backup (
  run_id uuid not null references public.material_inventory_warehouse_migration_runs(id) on delete cascade,
  table_name text not null,
  row_data jsonb not null,
  created_at timestamptz not null default now()
);

alter table if exists public.transfers
  add column if not exists legacy_from_location_id text,
  add column if not exists legacy_to_location_id text;

alter table if exists public.inventory_adjustments
  add column if not exists legacy_location_id text;

alter table if exists public.mixed_materials
  add column if not exists legacy_location_id text;

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
  where not l.id like 'erp-loc-%';

  insert into public.material_inventory_legacy_location_backup(run_id, table_name, row_data)
  select v_run_id, 'daily_entries', to_jsonb(de)
  from public.daily_entries de
  join public.locations l on l.id = de.location_id
  where not l.id like 'erp-loc-%';

  insert into public.material_inventory_legacy_location_backup(run_id, table_name, row_data)
  select v_run_id, 'daily_entry_measurements', to_jsonb(dm)
  from public.daily_entry_measurements dm
  join public.locations l on l.id = dm.location_id
  where not l.id like 'erp-loc-%';

  insert into public.material_inventory_legacy_location_backup(run_id, table_name, row_data)
  select v_run_id, 'daily_location_status', to_jsonb(ds)
  from public.daily_location_status ds
  join public.locations l on l.id = ds.location_id
  where not l.id like 'erp-loc-%';

  insert into public.material_inventory_legacy_location_backup(run_id, table_name, row_data)
  select v_run_id, 'transfers', to_jsonb(t)
  from public.transfers t
  where t.from_location_id is not null or t.to_location_id is not null;

  insert into public.material_inventory_legacy_location_backup(run_id, table_name, row_data)
  select v_run_id, 'inventory_adjustments', to_jsonb(a)
  from public.inventory_adjustments a;

  insert into public.locations(id, warehouse_id, name, order_no, type, is_active)
  select
    'warehouse-inventory-' || w.id,
    w.id,
    w.name,
    0,
    'pole',
    true
  from public.warehouses w
  where w.is_active is true
    and not w.id like 'erp-wh-%'
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
    and t.from_location_id is distinct from 'warehouse-inventory-' || lf.warehouse_id;

  update public.transfers t
  set
    legacy_to_location_id = coalesce(t.legacy_to_location_id, t.to_location_id),
    to_location_id = 'warehouse-inventory-' || lt.warehouse_id
  from public.locations lt
  join public.warehouses wt on wt.id = lt.warehouse_id
  where t.to_location_id = lt.id
    and not wt.id like 'erp-wh-%'
    and t.to_location_id is distinct from 'warehouse-inventory-' || lt.warehouse_id;

  update public.inventory_adjustments a
  set
    legacy_location_id = coalesce(a.legacy_location_id, a.location_id),
    location_id = 'warehouse-inventory-' || l.warehouse_id
  from public.locations l
  join public.warehouses w on w.id = l.warehouse_id
  where a.location_id = l.id
    and not w.id like 'erp-wh-%'
    and a.location_id is distinct from 'warehouse-inventory-' || l.warehouse_id;

  update public.mixed_materials m
  set
    legacy_location_id = coalesce(m.legacy_location_id, m.location_id),
    location_id = 'warehouse-inventory-' || l.warehouse_id
  from public.locations l
  join public.warehouses w on w.id = l.warehouse_id
  where m.location_id = l.id
    and not w.id like 'erp-wh-%'
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

notify pgrst, 'reload schema';

commit;
