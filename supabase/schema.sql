-- AGRO-MAR HACCP/FIFO v1
-- URUCHAMIAĆ WYŁĄCZNIE W NOWYM PROJEKCIE SUPABASE: AGRO-MAR-HACCP.
-- NIE uruchamiać w projekcie AGRO-MAR od aplikacji opakowań.

create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text unique,
  role text not null default 'magazynier' check (role in ('admin','magazynier')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  product_type text not null default 'surowiec_lub_produkt',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into products(name, code, product_type) values
('Malina pulpa','Mp','produkt_gotowy'),
('Porzeczka czarna','Pcz','surowiec_lub_produkt'),
('Porzeczka czerwona','Pk','surowiec_lub_produkt'),
('Truskawka','T','surowiec_lub_produkt'),
('Truskawka z szypułką','Tsz','surowiec_lub_produkt'),
('Aronia','A','surowiec_lub_produkt'),
('Śliwka','S','surowiec_lub_produkt'),
('Wiśnia','W','surowiec_lub_produkt'),
('Malina klasa I','M1','surowiec_lub_produkt'),
('Malina extra','Mex','surowiec_lub_produkt'),
('Jabłko obierka','Jo','surowiec_lub_produkt')
on conflict (code) do nothing;

create table if not exists contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contractor_type text not null default 'oba' check (contractor_type in ('dostawca','odbiorca','oba')),
  nip text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(name)
);

create table if not exists imported_files (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  imported_by uuid references app_users(id),
  imported_at timestamptz not null default now(),
  rows_count int not null default 0,
  status text not null default 'wczytany'
);

create table if not exists operations (
  id uuid primary key default gen_random_uuid(),
  operation_type text not null check (operation_type in ('przyjecie','sprzedaz_bez_produkcji','produkcja')),
  operation_date date not null,
  document_no text,
  invoice_no text,
  contractor_id uuid references contractors(id),
  imported_file_id uuid references imported_files(id),
  notes text,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

create table if not exists lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  lot_no text not null unique,
  source_operation_id uuid references operations(id),
  production_date date,
  initial_qty numeric(12,3) not null default 0,
  remaining_qty numeric(12,3) not null default 0,
  unit text not null default 'kg',
  status text not null default 'aktywna' check (status in ('aktywna','zuzyta','wycofana','zablokowana')),
  created_at timestamptz not null default now()
);

create table if not exists lot_sequences (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  year int not null,
  next_number int not null default 1,
  unique(product_id, year)
);

create table if not exists operation_items (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references operations(id) on delete cascade,
  product_id uuid not null references products(id),
  qty numeric(12,3) not null,
  unit text not null default 'kg',
  lot_id uuid references lots(id),
  direction text not null check (direction in ('przychod','rozchod')),
  raw_product_name text,
  notes text
);

create table if not exists fifo_allocations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references operations(id) on delete cascade,
  output_lot_id uuid references lots(id),
  source_lot_id uuid not null references lots(id),
  product_id uuid not null references products(id),
  qty numeric(12,3) not null,
  created_at timestamptz not null default now()
);

create table if not exists document_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0
);
insert into document_categories(name, sort_order) values
('Karty kontrolne',1),('Raporty',2),('Formularze',3),('Protokoły',4),('Wykazy',5),('Karty stanowiskowe',6),('Pozostałe IFS',7),('Specyfikacje',8)
on conflict(name) do nothing;

create table if not exists document_templates (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references document_categories(id),
  code text not null unique,
  title text not null,
  original_filename text,
  storage_path text,
  automation_level text not null default 'reczny' check (automation_level in ('auto','polauto','reczny')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists generated_documents (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references document_templates(id),
  related_operation_id uuid references operations(id),
  related_lot_id uuid references lots(id),
  year int,
  month int,
  status text not null default 'roboczy' check (status in ('roboczy','zatwierdzony','wydrukowany')),
  data jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cleaning_rules (
  id uuid primary key default gen_random_uuid(),
  trigger_event text not null check (trigger_event in ('przyjecie','produkcja','sprzedaz_transport')),
  area_or_machine text not null,
  process_code text not null default 'M/C/D',
  document_code text not null,
  is_active boolean not null default true
);
insert into cleaning_rules(trigger_event, area_or_machine, process_code, document_code) values
('przyjecie','Pomieszczenie przyjęcia surowców','M/C/D','R01'),
('produkcja','Pomieszczenie produkcyjne','M/C/D','R01'),
('produkcja','Hala do produkcji pulpy','M/C/D','R01'),
('produkcja','Wanna zasypowa / młynek / waga','M/C/D','R02'),
('sprzedaz_transport','Środek transportu','M/C','R03')
on conflict do nothing;

create table if not exists import_column_mappings (
  id uuid primary key default gen_random_uuid(),
  source_name text not null default 'agromarbanka',
  field_name text not null,
  excel_header text not null,
  is_required boolean not null default true,
  unique(source_name, field_name)
);
insert into import_column_mappings(field_name, excel_header, is_required) values
('document_no','Nr', true),
('document_type','Rodzaj', true),
('issue_date','Data wystawienia', true),
('qty','Ilość.1', true),
('product_name','Produkt/usługa', true),
('contractor_name','Odbiorca', false),
('invoice_no','Faktura', false)
on conflict(source_name, field_name) do update set excel_header = excluded.excel_header;

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function generate_lot_no(p_product_id uuid, p_date date)
returns text
language plpgsql
as $$
declare
  v_year int := extract(year from p_date)::int;
  v_code text;
  v_number int;
begin
  select code into v_code from products where id = p_product_id;
  if v_code is null then
    raise exception 'Nie znaleziono produktu';
  end if;
  insert into lot_sequences(product_id, year, next_number)
  values (p_product_id, v_year, 2)
  on conflict (product_id, year)
  do update set next_number = lot_sequences.next_number + 1
  returning next_number - 1 into v_number;
  return v_code || '/' || lpad(v_number::text, 3, '0') || '/' || v_year::text;
end;
$$;

create or replace view v_stock as
select p.name, p.code, l.lot_no, l.production_date, l.initial_qty, l.remaining_qty, l.unit, l.status
from lots l
join products p on p.id = l.product_id
order by p.name, l.production_date, l.created_at;
