begin;

alter table if exists public.warehouse_transfer_documents
  drop constraint if exists warehouse_transfer_documents_status_check;

alter table if exists public.warehouse_transfer_documents
  add constraint warehouse_transfer_documents_status_check
  check (status in ('OPEN', 'ISSUED', 'CLOSED'));

commit;
