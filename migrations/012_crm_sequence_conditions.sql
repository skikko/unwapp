-- Aggiunge condizioni concatenate ai trigger automatici delle sequenze CRM.

ALTER TABLE crm_sequences
  ADD COLUMN IF NOT EXISTS trigger_conditions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE crm_sequences
  DROP CONSTRAINT IF EXISTS crm_sequences_trigger_conditions_check;

ALTER TABLE crm_sequences
  ADD CONSTRAINT crm_sequences_trigger_conditions_check
  CHECK (jsonb_typeof(trigger_conditions) = 'array');
