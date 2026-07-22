BEGIN;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS contact_name TEXT;

UPDATE broadcast_recipients
SET contact_name = NULLIF(BTRIM(COALESCE(
  NULLIF(BTRIM(contact_data->>'Nome Cognome'), ''),
  NULLIF(BTRIM(contact_data->>'nome cognome'), ''),
  NULLIF(BTRIM(contact_data->>'full_name'), ''),
  NULLIF(BTRIM(contact_data->>'Full Name'), ''),
  NULLIF(BTRIM(CONCAT_WS(' ',
    COALESCE(contact_data->>'Nome', contact_data->>'nome', contact_data->>'Name', contact_data->>'name', contact_data->>'first_name'),
    COALESCE(contact_data->>'Cognome', contact_data->>'cognome', contact_data->>'Surname', contact_data->>'surname', contact_data->>'last_name')
  )), '')
)), '')
WHERE NULLIF(BTRIM(contact_name), '') IS NULL;

WITH latest AS (
  SELECT DISTINCT ON (bc.bot_id, br.phone_number)
         bc.bot_id, br.phone_number, br.contact_name
  FROM broadcast_recipients br
  JOIN broadcast_campaigns bc ON bc.id = br.campaign_id
  WHERE NULLIF(BTRIM(br.contact_name), '') IS NOT NULL
  ORDER BY bc.bot_id, br.phone_number, bc.created_at DESC, br.row_number DESC
)
UPDATE conversations c
SET contact_name = latest.contact_name
FROM latest
WHERE c.bot_id = latest.bot_id
  AND c.phone_number = latest.phone_number
  AND NULLIF(BTRIM(c.contact_name), '') IS NULL;

COMMIT;
