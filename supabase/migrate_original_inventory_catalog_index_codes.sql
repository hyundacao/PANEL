alter table if exists public.original_inventory_catalog
  add column if not exists index_code text;

alter table if exists public.original_inventory_catalog
  add column if not exists warehouse_code text;

delete from public.original_inventory_catalog
where coalesce(trim(index_code), '') = '';

update public.original_inventory_catalog
set warehouse_code =
  upper(regexp_replace(substring(index_code from '(?i)M[- ]?\d+'), '\s+', '-', 'g'))
where coalesce(trim(warehouse_code), '') = ''
  and coalesce(trim(index_code), '') <> ''
  and substring(index_code from '(?i)M[- ]?\d+') is not null;

delete from public.original_inventory_catalog
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by lower(name), coalesce(lower(index_code), '')
        order by created_at asc, id asc
      ) as row_no
    from public.original_inventory_catalog
  ) duplicates
  where row_no > 1
);

drop index if exists original_inventory_catalog_name_idx;

create unique index if not exists original_inventory_catalog_name_index_idx
  on public.original_inventory_catalog (
    lower(name),
    coalesce(lower(index_code), '')
  );
