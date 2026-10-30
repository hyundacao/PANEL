-- Indeks 1 i indeks 2 sa kolumnami tego samego rekordu.
-- Uruchom po 04 i 10. Nie scala kartotek ani nie zmienia zadnych stanow.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.original_inventory_catalog add column if not exists index_code2 text;
alter table public.original_inventory_erp_snapshots add column if not exists index_code2 text;
comment on column public.original_inventory_catalog.index_code is 'Indeks 1 z kolumny Indeks / Indeks 1 importu ERP.';
comment on column public.original_inventory_catalog.index_code2 is 'Indeks 2 z osobnej kolumny importu. Nie jest wyliczany z indeksu 1.';

create or replace function public.update_original_inventory_catalog_items_v2(p_changes jsonb)
returns table(id uuid, updated boolean)
language plpgsql security definer set search_path = '' as $$
declare
  change jsonb;
  changed_id uuid;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'CHANGES_ARRAY_REQUIRED';
  end if;
  if jsonb_array_length(p_changes) > 500 then raise exception 'TOO_MANY_CHANGES'; end if;
  for change in select value from jsonb_array_elements(p_changes) loop
    changed_id := null;
    begin
      update public.original_inventory_catalog c
      set name = btrim(change ->> 'name'),
          index_code2 = coalesce(nullif(btrim(change ->> 'indexCode2'), ''), c.index_code2),
          previous_names = case when c.name = btrim(change ->> 'name') then c.previous_names
            else array(select distinct n from unnest(c.previous_names || array[c.name]) n where btrim(n) <> '') end
      where c.id = (change ->> 'id')::uuid
        and c.name = change ->> 'previousName'
        and c.index_code = change ->> 'indexCode'
        and c.index_code2 is not distinct from (change ->> 'previousIndexCode2')
        and btrim(coalesce(change ->> 'name', '')) <> ''
        and btrim(coalesce(change ->> 'indexCode', '')) <> ''
      returning c.id into changed_id;
    exception when unique_violation then
      changed_id := null;
    end;
    return query select (change ->> 'id')::uuid, changed_id is not null;
  end loop;
end;
$$;
revoke all on function public.update_original_inventory_catalog_items_v2(jsonb) from public, anon, authenticated;
grant execute on function public.update_original_inventory_catalog_items_v2(jsonb) to service_role;

-- The existing atomic import retains archive protections and quantity validation.
create or replace function public.replace_original_inventory_erp_snapshot_v2(
  p_date date, p_rows jsonb, p_imported_by text, p_source_file text
) returns table(inserted integer, replaced integer)
language plpgsql security definer set search_path = '' as $$
begin
  return query select * from public.replace_original_inventory_erp_snapshot(p_date, p_rows, p_imported_by, p_source_file);
  update public.original_inventory_erp_snapshots s
  set index_code2 = nullif(btrim(x.index_code2), '')
  from jsonb_to_recordset(p_rows) as x(name text, index_code text, index_code2 text)
  where s.snapshot_date = p_date and s.name = x.name and s.index_code is not distinct from x.index_code;
end;
$$;
revoke all on function public.replace_original_inventory_erp_snapshot_v2(date,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.replace_original_inventory_erp_snapshot_v2(date,jsonb,text,text) to service_role;

notify pgrst, 'reload schema';
commit;
select 'Indeksy kartotek' as modul, 'OK' as wynik;
