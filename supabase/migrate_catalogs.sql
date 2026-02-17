begin;

create table if not exists public.material_catalogs (
  id text primary key,
  name text not null,
  is_active boolean not null default true
);

create unique index if not exists material_catalogs_name_idx
  on public.material_catalogs (lower(name));

alter table if exists public.materials
  add column if not exists catalog_id text references public.material_catalogs(id) on delete set null;

create index if not exists materials_catalog_idx
  on public.materials (catalog_id);

alter table if exists public.material_catalogs enable row level security;

insert into public.material_catalogs (id, name, is_active)
select concat('cat-', md5(lower(src.code))) as id, src.code as name, true
from (
  select min(trim(code)) as code
  from public.materials
  where code is not null and length(trim(code)) > 0
  group by lower(trim(code))
) as src
on conflict (id) do update
set name = excluded.name;

update public.materials as m
set catalog_id = c.id
from public.material_catalogs as c
where lower(m.code) = lower(c.name)
  and m.catalog_id is null;

commit;
