-- Retry script for a Supabase setup run that already failed at the previous do $ syntax error in the warehouse-only normalization block.
-- Run this once after that failed setup; do not use it as a fresh full setup script.

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

create unique index if not exists permission_groups_name_lower_idx
  on public.permission_groups (lower(name));

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

create unique index if not exists erp_target_locations_name_lower_uq
  on public.erp_target_locations (lower(name));

create index if not exists erp_target_locations_active_order_idx
  on public.erp_target_locations (is_active, order_no, name);

alter table if exists public.erp_target_locations enable row level security;

insert into public.erp_target_locations (name, order_no, is_active)
values
  ('HALA 1', 1, true),
  ('HALA 2', 2, true),
  ('HALA 3', 3, true),
  ('BAKOMA', 4, true),
  ('PACZKA', 5, true),
  ('LAKIERNIA', 6, true),
  ('INNA LOKALIZACJA', 999, true)
on conflict do nothing;

commit;

notify pgrst, 'reload schema';

alter table original_inventory_entries
  add column if not exists source_type text,
  add column if not exists source_id text;

create unique index if not exists original_inventory_entries_source_idx
  on original_inventory_entries(source_type, source_id)
  where source_type is not null and source_id is not null;

create table if not exists original_inventory_silos (
  id uuid primary key,
  name text not null,
  chamber text not null,
  material_name text not null,
  warehouse_id text not null references warehouses(id) on delete restrict,
  percent_kg numeric not null default 0,
  hopper_kg numeric not null default 0,
  is_active boolean not null default true,
  order_no integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists original_inventory_silo_entries (
  id uuid primary key,
  config_id uuid not null references original_inventory_silos(id) on delete cascade,
  date_key text not null,
  percent numeric not null default 0,
  hopper_present boolean not null default false,
  calculated_qty numeric not null default 0,
  generated_entry_id uuid references original_inventory_entries(id) on delete set null,
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
