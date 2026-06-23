-- AGRO-MAR HACCP/FIFO v16
-- Produkty gotowe bez fikcyjnej pozycji "Jabłko pulpa".
-- Dodaje możliwość tworzenia partii produktu gotowego także bez przerobu,
-- dla wszystkich surowców/owoców używanych w systemie.

BEGIN;

-- Nie używamy pozycji "Jabłko pulpa".
UPDATE public.products
SET is_active = false
WHERE lower(name) IN ('jabłko pulpa', 'jablko pulpa') OR code = 'Jp';

-- Uporządkowanie produktów i kodów partii.
INSERT INTO public.products (name, code, product_type, product_group, is_active)
VALUES
  ('Malina pulpa', 'Mp', 'produkt_gotowy', 'malina', true),
  ('Porzeczka czarna pulpa', 'Pczp', 'produkt_gotowy', 'porzeczka_czarna', true),
  ('Porzeczka czerwona pulpa', 'Pkp', 'produkt_gotowy', 'porzeczka_czerwona', true),
  ('Malina klasa I', 'M1', 'surowiec_lub_produkt', 'malina', true),
  ('Malina extra', 'Mex', 'surowiec_lub_produkt', 'malina', true),
  ('Wiśnia', 'W', 'surowiec_lub_produkt', 'wisnia', true),
  ('Aronia', 'A', 'surowiec_lub_produkt', 'aronia', true),
  ('Śliwka', 'S', 'surowiec_lub_produkt', 'sliwka', true),
  ('Truskawka', 'T', 'surowiec_lub_produkt', 'truskawka', true),
  ('Truskawka z szypułką', 'Tsz', 'surowiec_lub_produkt', 'truskawka', true),
  ('Porzeczka czarna', 'Pcz', 'surowiec_lub_produkt', 'porzeczka_czarna', true),
  ('Porzeczka czerwona', 'Pk', 'surowiec_lub_produkt', 'porzeczka_czerwona', true),
  ('Jabłko przemysłowe', 'Jab', 'surowiec_lub_produkt', 'jab_przem', true),
  ('Jabłko obierka', 'Jabobier', 'surowiec_lub_produkt', 'jab_obier', true),
  ('Jabłko na obierkę', 'Jabobier', 'surowiec_lub_produkt', 'jab_obier', true)
ON CONFLICT (code) DO UPDATE
SET product_type = EXCLUDED.product_type,
    product_group = EXCLUDED.product_group,
    is_active = true;

-- Grupy produktów na istniejących rekordach.
UPDATE public.products SET product_group = 'jab_obier', code = 'Jabobier'
WHERE lower(name) LIKE '%obier%';

UPDATE public.products SET product_group = 'jab_przem', code = 'Jab'
WHERE (lower(name) LIKE '%jabł%' OR lower(name) LIKE '%jabl%')
  AND lower(name) NOT LIKE '%obier%'
  AND lower(name) NOT LIKE '%pulpa%';

UPDATE public.products SET product_group = 'malina'
WHERE lower(name) LIKE '%malin%';

UPDATE public.products SET product_group = 'wisnia'
WHERE lower(name) LIKE '%wiś%' OR lower(name) LIKE '%wis%';

UPDATE public.products SET product_group = 'aronia'
WHERE lower(name) LIKE '%aron%';

UPDATE public.products SET product_group = 'sliwka'
WHERE lower(name) LIKE '%śliw%' OR lower(name) LIKE '%sliw%';

UPDATE public.products SET product_group = 'truskawka'
WHERE lower(name) LIKE '%trusk%';

UPDATE public.products SET product_group = 'porzeczka_czarna'
WHERE lower(name) LIKE '%porzeczka czarna%';

UPDATE public.products SET product_group = 'porzeczka_czerwona'
WHERE lower(name) LIKE '%porzeczka czerwona%';

UPDATE public.lots l
SET product_group = p.product_group
FROM public.products p
WHERE p.id = l.product_id;

COMMIT;

SELECT name, code, product_type, product_group, is_active
FROM public.products
WHERE is_active = true
ORDER BY name;
