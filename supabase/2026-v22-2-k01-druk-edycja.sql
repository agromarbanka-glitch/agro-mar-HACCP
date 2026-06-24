-- v22.2 nie wymaga zmian struktury bazy.
-- Poprawka dotyczy widoku K01, druku i edycji pojedynczych pól dokumentu.
SELECT document_type, COUNT(*) AS liczba
FROM public.haccp_documents
GROUP BY document_type
ORDER BY document_type;
