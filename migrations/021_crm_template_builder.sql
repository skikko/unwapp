ALTER TABLE crm_email_templates
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS template_type TEXT NOT NULL DEFAULT 'marketing',
  ADD COLUMN IF NOT EXISTS editor_mode TEXT NOT NULL DEFAULT 'visual',
  ADD COLUMN IF NOT EXISTS builder_json JSONB,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

UPDATE crm_email_templates
SET slug = lower(trim(both '-' FROM regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))
WHERE slug IS NULL OR slug = '';

WITH duplicates AS (
  SELECT id, slug, count(*) OVER (PARTITION BY slug) AS occurrences
  FROM crm_email_templates
)
UPDATE crm_email_templates template
SET slug = template.slug || '-' || template.id::text
FROM duplicates
WHERE duplicates.id = template.id AND duplicates.occurrences > 1;

UPDATE crm_email_templates
SET slug = 'template-' || left(id::text, 8)
WHERE slug IS NULL OR slug = '';

ALTER TABLE crm_email_templates
  ALTER COLUMN slug SET NOT NULL;

ALTER TABLE crm_email_templates DROP CONSTRAINT IF EXISTS crm_email_templates_type_check;
ALTER TABLE crm_email_templates ADD CONSTRAINT crm_email_templates_type_check
  CHECK (template_type IN ('marketing','transactional'));

ALTER TABLE crm_email_templates DROP CONSTRAINT IF EXISTS crm_email_templates_editor_mode_check;
ALTER TABLE crm_email_templates ADD CONSTRAINT crm_email_templates_editor_mode_check
  CHECK (editor_mode IN ('visual','html'));

ALTER TABLE crm_email_templates DROP CONSTRAINT IF EXISTS crm_email_templates_version_check;
ALTER TABLE crm_email_templates ADD CONSTRAINT crm_email_templates_version_check
  CHECK (version > 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_email_templates_slug
  ON crm_email_templates (slug);
