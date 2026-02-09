begin;

create table if not exists public.warehouse_transfer_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by_id uuid,
  created_by_name text not null,
  document_number text not null,
  source_warehouse text,
  target_warehouse text,
  note text,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  closed_at timestamptz,
  closed_by_name text
);

create index if not exists warehouse_transfer_documents_created_idx
  on public.warehouse_transfer_documents (created_at);
create index if not exists warehouse_transfer_documents_number_idx
  on public.warehouse_transfer_documents (document_number);

create table if not exists public.warehouse_transfer_document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.warehouse_transfer_documents(id) on delete cascade,
  line_no integer not null default 1,
  index_code text not null,
  index_code2 text,
  name text not null,
  batch text,
  location text,
  unit text not null default 'kg',
  planned_qty numeric not null check (planned_qty > 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists warehouse_transfer_document_items_document_idx
  on public.warehouse_transfer_document_items (document_id);
create index if not exists warehouse_transfer_document_items_index_idx
  on public.warehouse_transfer_document_items (index_code);

create table if not exists public.warehouse_transfer_item_receipts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.warehouse_transfer_document_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  receiver_id uuid,
  receiver_name text not null,
  qty numeric not null check (qty > 0),
  note text
);

create index if not exists warehouse_transfer_item_receipts_item_idx
  on public.warehouse_transfer_item_receipts (item_id);
create index if not exists warehouse_transfer_item_receipts_created_idx
  on public.warehouse_transfer_item_receipts (created_at);

alter table if exists public.warehouse_transfer_documents enable row level security;
alter table if exists public.warehouse_transfer_document_items enable row level security;
alter table if exists public.warehouse_transfer_item_receipts enable row level security;

commit;
