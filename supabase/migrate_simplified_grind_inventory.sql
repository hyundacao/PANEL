begin;

insert into public.warehouses (id, name, order_no, include_in_spis, include_in_stats, is_active) values
  ('hall-1', 'Hala 1', 1, true, true, true),
  ('hall-2', 'Hala 2', 2, true, true, true),
  ('hall-3', 'Hala 3', 3, true, true, true),
  ('mill-pp', 'Pomieszczenie z młynem PP', 4, true, true, true)
on conflict (id) do update set
  name = excluded.name,
  order_no = excluded.order_no,
  include_in_spis = excluded.include_in_spis,
  include_in_stats = excluded.include_in_stats,
  is_active = excluded.is_active;

update public.locations
set is_active = false
where warehouse_id in ('hall-1', 'hall-2', 'hall-3', 'mill-pp')
  and id not in ('hall-1-spis', 'hall-2-spis', 'hall-3-spis', 'mill-pp-spis');

insert into public.locations (id, warehouse_id, name, order_no, type, is_active) values
  ('hall-1-spis', 'hall-1', 'Hala 1', 1, 'pole', true),
  ('hall-2-spis', 'hall-2', 'Hala 2', 1, 'pole', true),
  ('hall-3-spis', 'hall-3', 'Hala 3', 1, 'pole', true),
  ('mill-pp-spis', 'mill-pp', 'Pomieszczenie z młynem PP', 1, 'pole', true)
on conflict (id) do update set
  warehouse_id = excluded.warehouse_id,
  name = excluded.name,
  order_no = excluded.order_no,
  type = excluded.type,
  is_active = excluded.is_active;

update public.locations
set is_active = false
where warehouse_id = 'wh-1777286268671-64d70582';

update public.warehouses
set is_active = false,
    include_in_spis = false,
    include_in_stats = false
where id = 'wh-1777286268671-64d70582';

with latest_legacy_entries as (
  select distinct on (de.location_id, de.material_id)
    l.warehouse_id,
    de.location_id,
    de.material_id,
    de.qty
  from public.daily_entries de
  join public.locations l on l.id = de.location_id
  where l.warehouse_id in (
    'hall-1',
    'hall-2',
    'hall-3',
    'mill-pp',
    'wh-1777286268671-64d70582'
  )
    and l.id not in ('hall-1-spis', 'hall-2-spis', 'hall-3-spis', 'mill-pp-spis')
    and de.date_key <= current_date - 1
  order by de.location_id, de.material_id, de.date_key desc
), aggregated as (
  select
    case
      when warehouse_id = 'wh-1777286268671-64d70582' then 'mill-pp'
      else warehouse_id
    end as warehouse_id,
    material_id,
    sum(qty) as qty
  from latest_legacy_entries
  group by
    case
      when warehouse_id = 'wh-1777286268671-64d70582' then 'mill-pp'
      else warehouse_id
    end,
    material_id
), baselines as (
  select
    current_date - 1 as date_key,
    case warehouse_id
      when 'hall-1' then 'hall-1-spis'
      when 'hall-2' then 'hall-2-spis'
      when 'hall-3' then 'hall-3-spis'
      when 'mill-pp' then 'mill-pp-spis'
    end as location_id,
    material_id,
    qty
  from aggregated
  where qty > 0
)
insert into public.daily_entries (
  date_key,
  location_id,
  material_id,
  qty,
  confirmed,
  comment,
  updated_at
)
select
  baseline.date_key,
  baseline.location_id,
  baseline.material_id,
  baseline.qty,
  true,
  'Stan bazowy po przejściu na spis zbiorczy',
  now()
from baselines baseline
where baseline.location_id is not null
  and not exists (
    select 1
    from public.daily_entries existing
    where existing.location_id = baseline.location_id
      and existing.date_key <= current_date - 1
  )
on conflict (date_key, location_id, material_id) do nothing;

commit;
