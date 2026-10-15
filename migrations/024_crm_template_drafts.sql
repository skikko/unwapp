ALTER TABLE crm_email_templates
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';

UPDATE crm_email_templates
SET status = 'published'
WHERE status IS NULL OR status NOT IN ('draft', 'published');

ALTER TABLE crm_email_templates DROP CONSTRAINT IF EXISTS crm_email_templates_status_check;
ALTER TABLE crm_email_templates ADD CONSTRAINT crm_email_templates_status_check
  CHECK (status IN ('draft', 'published'));

CREATE INDEX IF NOT EXISTS idx_crm_email_templates_status_updated
  ON crm_email_templates (status, updated_at DESC);
