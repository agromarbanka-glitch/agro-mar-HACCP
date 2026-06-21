-- V4: widok pomocniczy dla stanów FIFO i zabezpieczenie duplikatów.
-- Uruchom w Supabase AGRO-MAR-HACCP.

create unique index if not exists operations_unique_document
on public.operations (operation_type, document_no)
where document_no is not null and document_no <> '';

create index if not exists lots_product_remaining_idx on public.lots (product_id, remaining_qty);
create index if not exists lots_fifo_order_idx on public.lots (product_id, production_date, created_at);
create index if not exists fifo_allocations_operation_idx on public.fifo_allocations (operation_id);

create or replace view public.v_fifo_stock as
select
  l.id as lot_id,
  p.name as product_name,
  p.code as product_code,
  l.lot_no,
  l.production_date,
  l.initial_qty,
  l.remaining_qty,
  l.status,
  l.created_at
from public.lots l
join public.products p on p.id = l.product_id
order by p.name, l.production_date, l.created_at;
