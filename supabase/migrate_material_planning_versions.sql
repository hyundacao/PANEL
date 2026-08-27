begin;

-- Ta migracja dotyczy wyłącznie zapisu modułu Planowanie zapotrzebowania.
-- Nie zmienia tabel, funkcji, polityk ani danych modułu Spis rzeczywisty.
alter table if exists public.material_planning_state
  add column if not exists revision bigint not null default 0;

create or replace function public.save_material_planning_state(
  p_module_id text,
  p_state jsonb,
  p_expected_revision bigint,
  p_updated_by text
)
returns table(new_revision bigint, has_conflict boolean)
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.save_material_planning_state(text, jsonb, bigint, text) from public;
grant execute on function public.save_material_planning_state(text, jsonb, bigint, text) to service_role;

comment on function public.save_material_planning_state(text, jsonb, bigint, text) is
  'Atomowy zapis modułu Planowanie zapotrzebowania z blokadą optymistyczną i dziennikiem zdarzeń.';

commit;
