create table if not exists public.original_inventory_erp_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  name text not null,
  real_qty numeric not null default 0,
  available_qty numeric not null default 0,
  unit text not null,
  imported_at timestamptz not null default now(),
  imported_by text not null,
  source_file_name text
);

alter table if exists public.original_inventory_erp_snapshots
  add column if not exists real_qty numeric;

alter table if exists public.original_inventory_erp_snapshots
  add column if not exists available_qty numeric;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'original_inventory_erp_snapshots'
      and column_name = 'qty'
  ) then
    execute $update$
      update public.original_inventory_erp_snapshots
      set
        real_qty = coalesce(real_qty, qty, 0),
        available_qty = coalesce(available_qty, qty, 0)
      where real_qty is null or available_qty is null
    $update$;
  else
    update public.original_inventory_erp_snapshots
    set
      real_qty = coalesce(real_qty, 0),
      available_qty = coalesce(available_qty, 0)
    where real_qty is null or available_qty is null;
  end if;
end $$;

alter table if exists public.original_inventory_erp_snapshots
  alter column real_qty set default 0;

alter table if exists public.original_inventory_erp_snapshots
  alter column available_qty set default 0;

alter table if exists public.original_inventory_erp_snapshots
  alter column real_qty set not null;

alter table if exists public.original_inventory_erp_snapshots
  alter column available_qty set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'original_inventory_erp_snapshots'
      and column_name = 'qty'
  ) then
    execute $compat$
      alter table public.original_inventory_erp_snapshots
        alter column qty drop not null
    $compat$;
  end if;
end $$;

create index if not exists original_inventory_erp_snapshots_date_idx
  on public.original_inventory_erp_snapshots (snapshot_date);

create unique index if not exists original_inventory_erp_snapshots_date_name_idx
  on public.original_inventory_erp_snapshots (snapshot_date, lower(name));

alter table if exists public.original_inventory_erp_snapshots enable row level security;
