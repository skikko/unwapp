-- Supporto operativo per liste, profili contatto, sequenze, API e storage media.

CREATE TABLE IF NOT EXISTS crm_list_exclusions (
  list_id UUID NOT NULL REFERENCES crm_lists(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_list_exclusions_contact
  ON crm_list_exclusions (contact_id);

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS consent_source TEXT,
  ADD COLUMN IF NOT EXISTS consent_proof JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS crm_contact_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_events_contact
  ON crm_contact_events (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_sequence_trigger_state (
  sequence_id UUID NOT NULL REFERENCES crm_sequences(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  is_member BOOLEAN NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sequence_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_sequence_trigger_state_member
  ON crm_sequence_trigger_state (sequence_id, is_member);

ALTER TABLE crm_sequence_enrollments
  DROP CONSTRAINT IF EXISTS crm_sequence_enrollments_status_check;
ALTER TABLE crm_sequence_enrollments
  ADD CONSTRAINT crm_sequence_enrollments_status_check
  CHECK (status IN ('active','paused','completed','failed','cancelled'));

ALTER TABLE crm_email_jobs
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claim_token UUID;
ALTER TABLE crm_email_jobs
  DROP CONSTRAINT IF EXISTS crm_email_jobs_status_check;
ALTER TABLE crm_email_jobs
  ADD CONSTRAINT crm_email_jobs_status_check
  CHECK (status IN ('pending','sending','sent','failed','cancelled'));

CREATE TABLE IF NOT EXISTS crm_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['contacts:write']::TEXT[],
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crm_api_keys_active
  ON crm_api_keys (active, source);

CREATE TABLE IF NOT EXISTS crm_ingest_requests (
  api_key_id UUID REFERENCES crm_api_keys(id) ON DELETE CASCADE,
  legacy_source TEXT,
  idempotency_key_hash TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB,
  status_code INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (api_key_id IS NOT NULL OR legacy_source IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_ingest_requests_key
  ON crm_ingest_requests (COALESCE(api_key_id::text, 'legacy:' || legacy_source), idempotency_key_hash);

ALTER TABLE media_assets
  ALTER COLUMN data DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'database',
  ADD COLUMN IF NOT EXISTS storage_key TEXT;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

WITH duplicates AS (
  SELECT id, row_number() OVER (PARTITION BY twilio_sid ORDER BY created_at ASC, id ASC) AS position
  FROM messages
  WHERE twilio_sid IS NOT NULL
)
UPDATE messages
SET twilio_sid = NULL
FROM duplicates
WHERE messages.id = duplicates.id AND duplicates.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_twilio_sid
  ON messages (twilio_sid) WHERE twilio_sid IS NOT NULL;

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_twilio_sid
  ON broadcast_recipients (twilio_sid) WHERE twilio_sid IS NOT NULL;
