-- v35: Pola domyślne K04.1, K05, K06 + generowanie K06 z produkcji
BEGIN;

CREATE OR REPLACE FUNCTION public.default_haccp_pn_fields(doc_type text)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT CASE
    WHEN doc_type = 'K01' THEN jsonb_build_object(
      'stan_higieniczny_pojazdu', 'P',
      'wybarwienie_zapach_brak_uszkodzen', 'P',
      'brak_zgnilizny_zaplesnienia_zagrzybienia', 'P',
      'uwagi', '',
      'podpis', ''
    )
    WHEN doc_type = 'K02' THEN jsonb_build_object(
      'stan_komory', 'P',
      'temperatura_prawidlowa', 'P',
      'czystosc', 'P',
      'temperatura', '',
      'uwagi', '',
      'podpis', ''
    )
    WHEN doc_type = 'K04' THEN jsonb_build_object(
      'stan_komory', 'P',
      'temperatura_prawidlowa', 'P',
      'czystosc', 'P',
      'temperatura', '',
      'uwagi', '',
      'podpis', ''
    )
    WHEN doc_type = 'K04.1' THEN jsonb_build_object(
      'temperatura_transport', '',
      'stan_opakowania', 'P',
      'uwagi', '',
      'podpis', ''
    )
    WHEN doc_type = 'K05' THEN jsonb_build_object(
      'powod_wycofania', '',
      'dzialanie', '',
      'podpis', ''
    )
    WHEN doc_type = 'K06' THEN jsonb_build_object(
      'wyglad_zapach', 'P',
      'smak', 'P',
      'barwa', 'P',
      'uwagi', '',
      'podpis', ''
    )
    WHEN doc_type = 'K07' THEN jsonb_build_object(
      'stan_sita', 'P',
      'sito_cale', 'P',
      'uwagi', '',
      'podpis', ''
    )
    ELSE '{}'::jsonb
  END;
$$;

-- K06: ocena jakości dla partii powstałych z produkcji/przerobu
INSERT INTO public.haccp_documents (
  document_type, lot_id, operation_id, document_date, product_name, lot_no,
  document_no, chamber_code, qty, status, data
)
SELECT
  'K06', l.id, l.source_operation_id,
  COALESCE(o.operation_date, l.production_date, current_date),
  p.name, l.lot_no, o.document_no, sc.code,
  CASE WHEN l.remaining_qty > 0 THEN l.remaining_qty ELSE l.initial_qty END,
  'P',
  public.default_haccp_pn_fields('K06')
FROM public.lots l
JOIN public.products p ON p.id = l.product_id
LEFT JOIN public.operations o ON o.id = l.source_operation_id
LEFT JOIN public.storage_chambers sc ON sc.id = COALESCE(l.storage_chamber_id, l.chamber_id)
WHERE o.operation_type = 'produkcja'
  AND NOT EXISTS (
    SELECT 1 FROM public.haccp_documents d
    WHERE d.document_type = 'K06' AND d.lot_id = l.id
  );

COMMIT;
