-- Aggiunge i trigger automatici alle sequenze CRM.

ALTER TABLE crm_sequences
  ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS trigger_list_id UUID REFERENCES crm_lists(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS trigger_started_at TIMESTAMPTZ;

ALTER TABLE crm_sequences
  DROP CONSTRAINT IF EXISTS crm_sequences_trigger_type_check;

ALTER TABLE crm_sequences
  ADD CONSTRAINT crm_sequences_trigger_type_check
  CHECK (trigger_type IN ('manual', 'list_joined'));

ALTER TABLE crm_sequences
  DROP CONSTRAINT IF EXISTS crm_sequences_trigger_configuration_check;

ALTER TABLE crm_sequences
  ADD CONSTRAINT crm_sequences_trigger_configuration_check
  CHECK (
    (trigger_type = 'manual' AND trigger_list_id IS NULL AND trigger_started_at IS NULL)
    OR
    (trigger_type = 'list_joined' AND trigger_list_id IS NOT NULL AND trigger_started_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_crm_sequences_trigger_list
  ON crm_sequences (trigger_list_id)
  WHERE trigger_type = 'list_joined';
