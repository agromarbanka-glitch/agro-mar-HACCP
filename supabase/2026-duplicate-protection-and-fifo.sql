-- Poprawka: zabezpieczenie przed ponownym importem tych samych dokumentów
-- oraz przygotowanie importu do pracy narastającej/FIFO.
-- Uruchomić tylko w projekcie Supabase: AGRO-MAR-HACCP.

-- 1. Blokada duplikatów dokumentów w bazie.
-- Jeżeli masz jeszcze testowe duplikaty w operations, najpierw je usuń.
create unique index if not exists operations_unique_document
on public.operations (operation_type, document_no)
where document_no is not null and document_no <> '';

-- 2. Wydajność przy wyszukiwaniu dokumentów i FIFO.
create index if not exists operations_document_no_idx on public.operations (document_no);
create index if not exists lots_product_remaining_idx on public.lots (product_id, remaining_qty);
create index if not exists lots_fifo_order_idx on public.lots (product_id, production_date, created_at);
create index if not exists operation_items_operation_idx on public.operation_items (operation_id);

-- 3. Uprawnienia testowe RLS dla tabel używanych przez import.
-- W wersji produkcyjnej zawęzimy je pod role admin/magazynier.
alter table public.imported_files enable row level security;
alter table public.contractors enable row level security;
alter table public.products enable row level security;
alter table public.operations enable row level security;
alter table public.operation_items enable row level security;
alter table public.lots enable row level security;
alter table public.lot_sequences enable row level security;
alter table public.fifo_allocations enable row level security;

drop policy if exists "Allow all imported_files" on public.imported_files;
drop policy if exists "Allow all contractors" on public.contractors;
drop policy if exists "Allow all products" on public.products;
drop policy if exists "Allow all operations" on public.operations;
drop policy if exists "Allow all operation_items" on public.operation_items;
drop policy if exists "Allow all lots" on public.lots;
drop policy if exists "Allow all lot_sequences" on public.lot_sequences;
drop policy if exists "Allow all fifo_allocations" on public.fifo_allocations;

create policy "Allow all imported_files" on public.imported_files for all to anon using (true) with check (true);
create policy "Allow all contractors" on public.contractors for all to anon using (true) with check (true);
create policy "Allow all products" on public.products for all to anon using (true) with check (true);
create policy "Allow all operations" on public.operations for all to anon using (true) with check (true);
create policy "Allow all operation_items" on public.operation_items for all to anon using (true) with check (true);
create policy "Allow all lots" on public.lots for all to anon using (true) with check (true);
create policy "Allow all lot_sequences" on public.lot_sequences for all to anon using (true) with check (true);
create policy "Allow all fifo_allocations" on public.fifo_allocations for all to anon using (true) with check (true);
