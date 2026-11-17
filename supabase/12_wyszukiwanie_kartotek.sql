-- Derived search data only. Does not change catalog identities, stock, plans or history.
-- Run after 04 and 07 (11 is optional for this projection).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists public.original_inventory_search_meta (
  id boolean primary key default true check (id),
  generation bigint not null default 1,
  prepared_generation bigint,
  format integer,
  prepared_at timestamptz
);
insert into public.original_inventory_search_meta(id) values (true) on conflict do nothing;

create table if not exists public.original_inventory_search_items (
  ordinal bigint primary key,
  item jsonb not null,
  search_values text[] not null,
  has_index2 boolean not null
);
alter table public.original_inventory_search_meta enable row level security;
alter table public.original_inventory_search_items enable row level security;
revoke all on public.original_inventory_search_meta, public.original_inventory_search_items from public, anon, authenticated;
grant all on public.original_inventory_search_meta, public.original_inventory_search_items to service_role;

create or replace function public.invalidate_original_inventory_search()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  changed_id text;
begin
  if tg_table_name = 'material_planning_state' and tg_op <> 'TRUNCATE' then
    if tg_op = 'DELETE' then changed_id := old.id; else changed_id := new.id; end if;
    if changed_id <> 'original-inventory-catalog-register' then return null; end if;
  end if;
  update public.original_inventory_search_meta set generation = generation + 1 where id;
  return null;
end;
$$;
revoke all on function public.invalidate_original_inventory_search() from public, anon, authenticated;

drop trigger if exists original_inventory_search_catalog_changed on public.original_inventory_catalog;
create trigger original_inventory_search_catalog_changed
after insert or update or delete or truncate on public.original_inventory_catalog
for each statement execute function public.invalidate_original_inventory_search();

drop trigger if exists original_inventory_search_register_changed on public.material_planning_state;
create trigger original_inventory_search_register_changed
after insert or update or delete on public.material_planning_state
for each row execute function public.invalidate_original_inventory_search();

drop trigger if exists original_inventory_search_register_truncated on public.material_planning_state;
create trigger original_inventory_search_register_truncated
after truncate on public.material_planning_state
for each statement execute function public.invalidate_original_inventory_search();

-- STABLE provides one MVCC snapshot for generation, raw catalog and register.
create or replace function public.get_original_inventory_search_source()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'generation', m.generation::text,
    'rows', coalesce((select jsonb_agg(to_jsonb(c)) from public.original_inventory_catalog c), '[]'::jsonb),
    'register', (select s.state from public.material_planning_state s where s.id = 'original-inventory-catalog-register')
  ) from public.original_inventory_search_meta m where m.id;
$$;

create or replace function public.publish_original_inventory_search(p_generation bigint, p_format integer, p_rows jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current_generation bigint;
  prepared bigint;
  current_format integer;
begin
  if p_generation is null or p_format is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'SEARCH_PROJECTION_INVALID';
  end if;
  select generation, prepared_generation, format into current_generation, prepared, current_format
    from public.original_inventory_search_meta where id for update;
  if current_generation is distinct from p_generation then return false; end if;
  if prepared = p_generation and current_format = p_format then return true; end if;
  -- Supabase safe-update protection rejects DELETE without a WHERE clause.
  delete from public.original_inventory_search_items where ordinal > 0;
  insert into public.original_inventory_search_items(ordinal, item, search_values, has_index2)
    select n, value -> 'item', array(select jsonb_array_elements_text(value -> 'searchValues')),
      btrim(coalesce(value -> 'item' ->> 'indexCode2', '')) <> ''
    from jsonb_array_elements(p_rows) with ordinality as rows(value, n);
  update public.original_inventory_search_meta set prepared_generation = p_generation,
    format = p_format, prepared_at = clock_timestamp() where id;
  return true;
end;
$$;

-- A coarse substring filter only. Numeric-run rules, aliases, deduplication and ranking stay in JS.
-- No early LIMIT: counted priority and warehouse rules must run on all matching identities.
create or replace function public.get_original_inventory_search_candidates(p_terms text[], p_only_index2 boolean, p_format integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ready', coalesce(m.prepared_generation = m.generation and m.format = p_format, false),
    'generation', m.generation::text,
    'items', case when m.prepared_generation = m.generation and m.format = p_format and cardinality(p_terms) > 0
      then coalesce((select jsonb_agg(s.item order by s.ordinal)
        from public.original_inventory_search_items s
        where (not p_only_index2 or s.has_index2) and not exists (
          select 1 from unnest(p_terms) term
          where not exists (select 1 from unnest(s.search_values) val where strpos(val, term) > 0)
        )), '[]'::jsonb)
      else '[]'::jsonb end
  ) from public.original_inventory_search_meta m where m.id;
$$;

revoke all on function public.get_original_inventory_search_source() from public, anon, authenticated;
revoke all on function public.publish_original_inventory_search(bigint,integer,jsonb) from public, anon, authenticated;
revoke all on function public.get_original_inventory_search_candidates(text[],boolean,integer) from public, anon, authenticated;
grant execute on function public.get_original_inventory_search_source() to service_role;
grant execute on function public.publish_original_inventory_search(bigint,integer,jsonb) to service_role;
grant execute on function public.get_original_inventory_search_candidates(text[],boolean,integer) to service_role;

notify pgrst, 'reload schema';
commit;
select '12_wyszukiwanie_kartotek' as module, 'OK' as status;
