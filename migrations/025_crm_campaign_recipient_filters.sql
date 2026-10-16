ALTER TABLE crm_email_campaigns
  ADD COLUMN IF NOT EXISTS recipient_filters JSONB;

ALTER TABLE crm_email_campaigns
  ALTER COLUMN recipient_filters SET DEFAULT '[]'::jsonb;

ALTER TABLE crm_email_campaigns
  DROP CONSTRAINT IF EXISTS crm_email_campaigns_recipient_filters_check;

ALTER TABLE crm_email_campaigns
  ADD CONSTRAINT crm_email_campaigns_recipient_filters_check
  CHECK (recipient_filters IS NULL OR jsonb_typeof(recipient_filters) = 'array');
