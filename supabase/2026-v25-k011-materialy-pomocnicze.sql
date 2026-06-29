-- v25 K01.1 - bezpieczne przygotowanie tabeli materiałów pomocniczych
create table if not exists public.haccp_aux_materials (
  id uuid primary key default gen_random_uuid(),
  delivery_date date not null,
  item_name text not null,
  supplier_invoice text not null,
  vehicle_hygiene text default 'P',
  qty text,
  lot_no text,
  notes text,
  signed_by text,
  source_filename text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.haccp_aux_materials enable row level security;

drop policy if exists "Allow all haccp_aux_materials" on public.haccp_aux_materials;
create policy "Allow all haccp_aux_materials"
on public.haccp_aux_materials
for all
to anon
using (true)
with check (true);

alter table public.haccp_aux_materials
  add column if not exists source_filename text,
  add column if not exists updated_at timestamptz default now();

select 'K01.1 tabela gotowa' as status;
