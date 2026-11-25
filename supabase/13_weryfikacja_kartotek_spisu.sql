-- 13. Odczyt rejestru do weryfikacji wpisow spisu.
-- Uruchom po 07. Zmiana nie zapisuje danych ani nie modyfikuje wyszukiwarki.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.get_original_inventory_validation_register(p_known_version text)
returns table(version text, unchanged boolean, state jsonb)
language sql
stable
security invoker
set search_path = ''
as $function$
  select token.version,
    coalesce(token.version = p_known_version, false),
    case when token.version = p_known_version then null else s.state end
  from public.material_planning_state as s
  -- A direct edit can change the row without advancing the application revision.
  cross join lateral (select s.xmin::text || ':' || s.revision::text || ':' ||
    extract(epoch from s.updated_at)::text as version) as token
  where s.id = 'original-inventory-catalog-register';
$function$;

revoke all on function public.get_original_inventory_validation_register(text) from public, anon, authenticated;
grant execute on function public.get_original_inventory_validation_register(text) to service_role;

notify pgrst, 'reload schema';
commit;
select '13_weryfikacja_kartotek_spisu' as module, 'OK' as status;
