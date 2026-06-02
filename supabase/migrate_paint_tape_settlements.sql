create table if not exists public.paint_tape_settlements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null default 'nieznany',
  order_number text,
  detail_name text not null,
  item_name text not null,
  item_index_code text,
  unit text not null default 'kg',
  start_qty numeric not null default 0 check (start_qty >= 0),
  warehouse_issued_qty numeric not null default 0 check (warehouse_issued_qty >= 0),
  end_qty numeric check (end_qty is null or end_qty >= 0),
  produced_qty numeric check (produced_qty is null or produced_qty >= 0),
  status text not null default 'OPEN' check (status in ('OPEN', 'DETAILS_REQUIRED', 'DONE'))
);

create index if not exists paint_tape_settlements_status_idx
  on public.paint_tape_settlements (status, created_at desc);

create index if not exists paint_tape_settlements_order_idx
  on public.paint_tape_settlements (lower(order_number));

create index if not exists paint_tape_settlements_item_idx
  on public.paint_tape_settlements (lower(item_name), lower(coalesce(item_index_code, '')));

alter table if exists public.paint_tape_settlements
  alter column order_number drop not null;

alter table if exists public.paint_tape_settlements
  add column if not exists accounted_at timestamptz,
  add column if not exists accounted_by text;

create table if not exists public.paint_tape_settlement_issues (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.paint_tape_settlements(id) on delete cascade,
  qty numeric not null check (qty <> 0),
  created_at timestamptz not null default now(),
  created_by text not null default 'nieznany'
);

create index if not exists paint_tape_settlement_issues_settlement_idx
  on public.paint_tape_settlement_issues (settlement_id, created_at);

insert into public.paint_tape_settlement_issues (settlement_id, qty, created_at, created_by)
select id, warehouse_issued_qty, created_at, created_by
from public.paint_tape_settlements settlement
where warehouse_issued_qty <> 0
  and not exists (
    select 1
    from public.paint_tape_settlement_issues issue
    where issue.settlement_id = settlement.id
  );

alter table if exists public.paint_tape_settlements enable row level security;
alter table if exists public.paint_tape_settlement_issues enable row level security;

notify pgrst, 'reload schema';
