-- Converte tutte le liste CRM in gruppi con appartenenza esclusivamente manuale.

UPDATE crm_lists
SET filter_json='{}'::jsonb,updated_at=now()
WHERE filter_json <> '{}'::jsonb;

DELETE FROM crm_list_exclusions;
