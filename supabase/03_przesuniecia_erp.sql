-- 03. Przesuniecia ERP
-- Wklej CALY plik do SQL Editor i uruchom Run. Kolejnosc pierwszego uruchomienia: 01-09.
-- Istniejace tabele, indeksy, funkcje, RLS i uprawnienia pozostaja bez zmian.
-- Nie resetuje danych, magazynow, kont, grup, zadan, raportow ani stanow.
-- Powtorne uruchomienie nie powiela danych. Jeden plik = jedna transakcja.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = public, extensions, pg_catalog;

-- SQL_SOURCE_BEGIN: tabela/warehouse_transfer_documents
-- warehouse_transfer_documents: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.warehouse_transfer_documents') is null then
    create table public."warehouse_transfer_documents" (
    "id" uuid default gen_random_uuid() not null,
    "created_at" timestamp with time zone default now() not null,
    "created_by_id" uuid,
    "created_by_name" text not null,
    "document_number" text not null,
    "source_warehouse" text,
    "target_warehouse" text,
    "note" text,
    "status" text default 'OPEN'::text not null,
    "closed_at" timestamp with time zone,
    "closed_by_name" text,
    constraint "warehouse_transfer_documents_pkey" PRIMARY KEY (id),
    constraint "warehouse_transfer_documents_status_check" CHECK (status = ANY (ARRAY['OPEN'::text, 'ISSUED'::text, 'CLOSED'::text]))
    );
    CREATE INDEX warehouse_transfer_documents_created_idx ON public.warehouse_transfer_documents USING btree (created_at);
    CREATE INDEX warehouse_transfer_documents_number_idx ON public.warehouse_transfer_documents USING btree (document_number);
    alter table public."warehouse_transfer_documents" enable row level security;
    grant all on table public."warehouse_transfer_documents" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/warehouse_transfer_documents

-- SQL_SOURCE_BEGIN: tabela/warehouse_transfer_document_items
-- warehouse_transfer_document_items: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.warehouse_transfer_document_items') is null then
    create table public."warehouse_transfer_document_items" (
    "id" uuid default gen_random_uuid() not null,
    "document_id" uuid not null,
    "line_no" integer default 1 not null,
    "priority" text default 'NORMAL'::text not null,
    "index_code" text not null,
    "index_code2" text,
    "name" text not null,
    "batch" text,
    "location" text,
    "unit" text default 'kg'::text not null,
    "planned_qty" numeric not null,
    "note" text,
    "created_at" timestamp with time zone default now() not null,
    constraint "warehouse_transfer_document_items_document_id_fkey" FOREIGN KEY (document_id) REFERENCES warehouse_transfer_documents(id) ON DELETE CASCADE,
    constraint "warehouse_transfer_document_items_pkey" PRIMARY KEY (id),
    constraint "warehouse_transfer_document_items_planned_qty_check" CHECK (planned_qty > 0::numeric),
    constraint "warehouse_transfer_document_items_priority_check" CHECK (priority = ANY (ARRAY['LOW'::text, 'NORMAL'::text, 'HIGH'::text, 'CRITICAL'::text]))
    );
    CREATE INDEX warehouse_transfer_document_items_document_idx ON public.warehouse_transfer_document_items USING btree (document_id);
    CREATE INDEX warehouse_transfer_document_items_index_idx ON public.warehouse_transfer_document_items USING btree (index_code);
    alter table public."warehouse_transfer_document_items" enable row level security;
    grant all on table public."warehouse_transfer_document_items" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/warehouse_transfer_document_items

-- SQL_SOURCE_BEGIN: tabela/warehouse_transfer_item_issues
-- warehouse_transfer_item_issues: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.warehouse_transfer_item_issues') is null then
    create table public."warehouse_transfer_item_issues" (
    "id" uuid default gen_random_uuid() not null,
    "item_id" uuid not null,
    "created_at" timestamp with time zone default now() not null,
    "issuer_id" uuid,
    "issuer_name" text not null,
    "qty" numeric not null,
    "note" text,
    constraint "warehouse_transfer_item_issues_item_id_fkey" FOREIGN KEY (item_id) REFERENCES warehouse_transfer_document_items(id) ON DELETE CASCADE,
    constraint "warehouse_transfer_item_issues_pkey" PRIMARY KEY (id),
    constraint "warehouse_transfer_item_issues_qty_check" CHECK (qty > 0::numeric)
    );
    CREATE INDEX warehouse_transfer_item_issues_created_idx ON public.warehouse_transfer_item_issues USING btree (created_at);
    CREATE INDEX warehouse_transfer_item_issues_item_idx ON public.warehouse_transfer_item_issues USING btree (item_id);
    alter table public."warehouse_transfer_item_issues" enable row level security;
    grant all on table public."warehouse_transfer_item_issues" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/warehouse_transfer_item_issues

-- SQL_SOURCE_BEGIN: tabela/warehouse_transfer_item_receipts
-- warehouse_transfer_item_receipts: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.warehouse_transfer_item_receipts') is null then
    create table public."warehouse_transfer_item_receipts" (
    "id" uuid default gen_random_uuid() not null,
    "item_id" uuid not null,
    "created_at" timestamp with time zone default now() not null,
    "receiver_id" uuid,
    "receiver_name" text not null,
    "qty" numeric not null,
    "note" text,
    constraint "warehouse_transfer_item_receipts_item_id_fkey" FOREIGN KEY (item_id) REFERENCES warehouse_transfer_document_items(id) ON DELETE CASCADE,
    constraint "warehouse_transfer_item_receipts_pkey" PRIMARY KEY (id),
    constraint "warehouse_transfer_item_receipts_qty_check" CHECK (qty > 0::numeric)
    );
    CREATE INDEX warehouse_transfer_item_receipts_created_idx ON public.warehouse_transfer_item_receipts USING btree (created_at);
    CREATE INDEX warehouse_transfer_item_receipts_item_idx ON public.warehouse_transfer_item_receipts USING btree (item_id);
    alter table public."warehouse_transfer_item_receipts" enable row level security;
    grant all on table public."warehouse_transfer_item_receipts" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/warehouse_transfer_item_receipts

-- SQL_SOURCE_BEGIN: tabela/erp_target_locations
-- erp_target_locations: istniejaca tabela jest pomijana w calosci, razem z jej ustawieniami.
do $install$
begin
  if to_regclass('public.erp_target_locations') is null then
    create table public."erp_target_locations" (
    "id" uuid default gen_random_uuid() not null,
    "name" text not null,
    "order_no" integer default 0 not null,
    "is_active" boolean default true not null,
    "created_at" timestamp with time zone default now() not null,
    "updated_at" timestamp with time zone default now() not null,
    constraint "erp_target_locations_pkey" PRIMARY KEY (id)
    );
    CREATE INDEX erp_target_locations_active_order_idx ON public.erp_target_locations USING btree (is_active, order_no, name);
    CREATE UNIQUE INDEX erp_target_locations_name_lower_uq ON public.erp_target_locations USING btree (lower(name));
    alter table public."erp_target_locations" enable row level security;
    grant all on table public."erp_target_locations" to service_role;
  end if;
end
$install$;

-- SQL_SOURCE_END: tabela/erp_target_locations

notify pgrst, 'reload schema';
commit;

select 'Przesuniecia ERP' as modul, 'OK'::text as wynik;
