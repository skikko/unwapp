CREATE TABLE IF NOT EXISTS crm_content_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL CHECK (kind IN ('template','sequence')),
  name        TEXT NOT NULL,
  description TEXT,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_content_folders_kind_name
  ON crm_content_folders (kind, lower(name));

ALTER TABLE crm_email_templates
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES crm_content_folders(id) ON DELETE SET NULL;

ALTER TABLE crm_sequences
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES crm_content_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_email_templates_folder
  ON crm_email_templates (folder_id);

CREATE INDEX IF NOT EXISTS idx_crm_sequences_folder
  ON crm_sequences (folder_id);

DROP TRIGGER IF EXISTS trg_crm_content_folders_updated_at ON crm_content_folders;
CREATE TRIGGER trg_crm_content_folders_updated_at
BEFORE UPDATE ON crm_content_folders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
