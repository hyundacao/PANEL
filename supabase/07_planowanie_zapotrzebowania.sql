-- 07. Planowanie zapotrzebowania
-- Wklej CALY plik do SQL Editor i uruchom Run. Kolejnosc pierwszego uruchomienia: 01-09.
-- Istniejace tabele, indeksy, funkcje, RLS i uprawnienia pozostaja bez zmian.
-- Nie resetuje danych, magazynow, kont, grup, zadan, raportow ani stanow.
-- Powtorne uruchomienie nie powiela danych. Jeden plik = jedna transakcja.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = public, extensions, pg_catalog;

-- SQL_SOURCE_BEGIN: tabela/material_planning_state
-- material_planning_state: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.material_planning_state') is null then
    create table public."material_planning_state" (
    "id" text not null,
    "state" jsonb default '{}'::jsonb not null,
    "updated_at" timestamp with time zone default now() not null,
    "updated_by" text default ''::text not null,
    "revision" bigint default 0 not null,
    constraint "material_planning_state_pkey" PRIMARY KEY (id)
    );
    alter table public."material_planning_state" enable row level security;
    grant all on table public."material_planning_state" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/material_planning_state

-- SQL_SOURCE_BEGIN: tabela/material_planning_events
-- material_planning_events: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.material_planning_events') is null then
    create table public."material_planning_events" (
    "id" uuid default gen_random_uuid() not null,
    "event_type" text not null,
    "event_data" jsonb default '{}'::jsonb not null,
    "created_at" timestamp with time zone default now() not null,
    "created_by" text default ''::text not null,
    constraint "material_planning_events_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX material_planning_events_created_at_idx ON public.material_planning_events USING btree (created_at DESC);
    alter table public."material_planning_events" enable row level security;
    grant all on table public."material_planning_events" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/material_planning_events

-- SQL_SOURCE_BEGIN: funkcja/save_material_planning_state
-- save_material_planning_state: nie nadpisuj wersji dzialajacej w bazie.
do $install$
begin
  if to_regprocedure('public.save_material_planning_state(text, jsonb, bigint, text)') is null then
    execute $definition$
CREATE OR REPLACE FUNCTION public.save_material_planning_state(p_module_id text, p_state jsonb, p_expected_revision bigint, p_updated_by text)
 RETURNS TABLE(new_revision bigint, has_conflict boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_revision bigint;
  next_revision bigint;
begin
  if p_module_id is null or btrim(p_module_id) = '' then
    raise exception 'MODULE_ID_REQUIRED';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'STATE_OBJECT_REQUIRED';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'EXPECTED_REVISION_INVALID';
  end if;

  insert into public.material_planning_state (id, state, updated_at, updated_by, revision)
  values (p_module_id, '{}'::jsonb, now(), coalesce(p_updated_by, ''), 0)
  on conflict (id) do nothing;

  select revision
    into current_revision
    from public.material_planning_state
    where id = p_module_id
    for update;

  if current_revision <> p_expected_revision then
    return query select current_revision, true;
    return;
  end if;

  next_revision := current_revision + 1;
  update public.material_planning_state
    set state = p_state,
        updated_at = now(),
        updated_by = coalesce(p_updated_by, ''),
        revision = next_revision
    where id = p_module_id;

  insert into public.material_planning_events (event_type, event_data, created_by)
  values (
    'STATE_SAVED',
    jsonb_build_object(
      'revision', next_revision,
      'planDate', coalesce(p_state ->> 'selectedPlanDate', ''),
      'planName', coalesce(p_state ->> 'planName', ''),
      'planSheet', coalesce(p_state ->> 'planSheet', '')
    ),
    coalesce(p_updated_by, '')
  );

  return query select next_revision, false;
end;
$function$
$definition$;
    revoke all on function public.save_material_planning_state(text, jsonb, bigint, text) from public, anon, authenticated;
    grant execute on function public.save_material_planning_state(text, jsonb, bigint, text) to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: funkcja/save_material_planning_state

notify pgrst, 'reload schema';
commit;

select 'Planowanie zapotrzebowania' as modul, 'OK'::text as wynik;
