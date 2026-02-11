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
