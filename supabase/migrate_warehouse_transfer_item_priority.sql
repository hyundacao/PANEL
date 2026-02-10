begin;

alter table if exists public.warehouse_transfer_document_items
  add column if not exists priority text;

update public.warehouse_transfer_document_items
set priority = 'NORMAL'
where priority is null or btrim(priority) = '';

alter table if exists public.warehouse_transfer_document_items
  alter column priority set default 'NORMAL';

alter table if exists public.warehouse_transfer_document_items
  alter column priority set not null;

alter table if exists public.warehouse_transfer_document_items
  drop constraint if exists warehouse_transfer_document_items_priority_check;

alter table if exists public.warehouse_transfer_document_items
  add constraint warehouse_transfer_document_items_priority_check
  check (priority in ('LOW', 'NORMAL', 'HIGH', 'CRITICAL'));

create index if not exists warehouse_transfer_document_items_priority_idx
  on public.warehouse_transfer_document_items (document_id, priority, line_no);

commit;
