-- =============================================================================
-- R01: przywróć brakujące obiekty ze wzoru Word (I/2024) we wszystkich kartotekach
-- Uruchom w Supabase SQL Editor → Run
-- =============================================================================

DO $$
DECLARE
  rec RECORD;
  defaults jsonb := '[
    {"id":"plac-przyzakladowy","label":"Plac przyzakładowy","auto_m":false},
    {"id":"pom-przyjecia","label":"Pomieszczenie przyjęcia surowców","auto_m":true},
    {"id":"chlodnia-surowca-1","label":"Komora chłodnicza surowców nr 1","auto_m":false},
    {"id":"chlodnia-surowca-2","label":"Komora chłodnicza surowców nr 2","auto_m":false},
    {"id":"pom-produkcyjne","label":"Pomieszczenie produkcyjne","auto_m":false},
    {"id":"hala-pulpy","label":"Hala do produkcji pulpy","auto_m":false},
    {"id":"chlodnia-gotowe-1","label":"Komora chłodnicza produktów gotowych nr 1","auto_m":false},
    {"id":"chlodnia-gotowe-2","label":"Komora chłodnicza produktów gotowych nr 2","auto_m":false}
  ]'::jsonb;
  def jsonb;
  col_id text;
  cols jsonb;
  cleaning jsonb;
  merged jsonb;
  sunday boolean;
  new_clean jsonb;
  existing jsonb;
BEGIN
  FOR rec IN SELECT id, data FROM public.haccp_documents WHERE document_type = 'R01' LOOP
    cols := COALESCE(rec.data->'room_columns', '[]'::jsonb);
    cleaning := COALESCE(rec.data->'cleaning', '{}'::jsonb);
    merged := '[]'::jsonb;

    FOR def IN SELECT * FROM jsonb_array_elements(defaults) LOOP
      col_id := def->>'id';
      existing := (
        SELECT elem FROM jsonb_array_elements(cols) elem WHERE elem->>'id' = col_id LIMIT 1
      );
      IF existing IS NOT NULL THEN
        merged := merged || existing;
      ELSE
        merged := merged || def;
        IF NOT cleaning ? col_id THEN
          cleaning := cleaning || jsonb_build_object(col_id, '');
        END IF;
      END IF;
    END LOOP;

    FOR def IN
      SELECT elem FROM jsonb_array_elements(cols) elem
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(defaults) d WHERE d->>'id' = elem->>'id'
      )
    LOOP
      merged := merged || def;
    END LOOP;

    sunday := COALESCE((rec.data->>'is_day_off')::boolean, false);
    new_clean := '{}'::jsonb;
    FOR def IN SELECT * FROM jsonb_array_elements(merged) LOOP
      col_id := def->>'id';
      IF cleaning ? col_id AND cleaning->>col_id IS NOT NULL AND cleaning->>col_id <> '' THEN
        new_clean := new_clean || jsonb_build_object(col_id, cleaning->>col_id);
      ELSIF NOT sunday AND (col_id = 'pom-przyjecia' OR (def->>'auto_m')::boolean = true) THEN
        new_clean := new_clean || jsonb_build_object(col_id, 'M');
      ELSE
        new_clean := new_clean || jsonb_build_object(col_id, '');
      END IF;
    END LOOP;

    UPDATE public.haccp_documents
    SET data = jsonb_set(
          jsonb_set(rec.data, '{room_columns}', merged),
          '{cleaning}', new_clean
        ),
        updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END $$;

-- Sprawdzenie – liczba obiektów w pierwszej kartotece R01 (powinno być 8):
SELECT
  document_date,
  jsonb_array_length(data->'room_columns') AS liczba_obiektow,
  data->'room_columns' AS obiekty
FROM public.haccp_documents
WHERE document_type = 'R01'
ORDER BY document_date
LIMIT 3;
