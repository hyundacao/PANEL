begin;

create table if not exists public.warehouse_transfer_item_issues (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.warehouse_transfer_document_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  issuer_id uuid,
  issuer_name text not null,
  qty numeric not null check (qty > 0),
  note text
);

create index if not exists warehouse_transfer_item_issues_item_idx
  on public.warehouse_transfer_item_issues (item_id);
create index if not exists warehouse_transfer_item_issues_created_idx
  on public.warehouse_transfer_item_issues (created_at);

alter table if exists public.warehouse_transfer_item_issues enable row level security;

commit;
