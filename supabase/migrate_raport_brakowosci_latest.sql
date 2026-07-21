create table if not exists public.raport_brakowosci_latest (
  id text primary key default 'latest',
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.raport_brakowosci_latest enable row level security;

drop policy if exists "raport_brakowosci_latest_service_role_all" on public.raport_brakowosci_latest;
create policy "raport_brakowosci_latest_service_role_all"
  on public.raport_brakowosci_latest
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

insert into public.raport_brakowosci_latest (id, payload)
values ('latest', 'null'::jsonb)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
