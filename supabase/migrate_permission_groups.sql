-- Permission groups (role templates) and user-group assignments.
-- Safe to re-run.

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

insert into public.permission_groups (name, description, access)
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
on conflict do nothing;
