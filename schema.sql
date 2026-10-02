-- Portable PostgreSQL 15 schema for UN WhatsApp Manager.
-- Requires the pgvector extension.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per "BOT": holds the Twilio number and the AI configuration
CREATE TABLE IF NOT EXISTS bots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  slug               TEXT UNIQUE NOT NULL,
  twilio_number      TEXT UNIQUE NOT NULL,
  provider           TEXT NOT NULL DEFAULT 'openai',
  model              TEXT NOT NULL DEFAULT 'gpt-4o',
  temperature        REAL NOT NULL DEFAULT 0.7,
  system_prompt      TEXT NOT NULL DEFAULT '',
  language           TEXT NOT NULL DEFAULT 'it',
  transfer_keywords  TEXT[] NOT NULL DEFAULT '{}',
  rag_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  ai_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  ai_api_key_encrypted TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE bots ADD COLUMN IF NOT EXISTS ai_api_key_encrypted TEXT;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  phone_number       TEXT NOT NULL,
  contact_name       TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  operator_email     TEXT,
  archived_at        TIMESTAMPTZ,
  unread_count       INT NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_read_at       TIMESTAMPTZ,
  last_message_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_id, phone_number)
);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS unread_count INT NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_conversations_bot_recent
  ON conversations (bot_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_bot_status_recent
  ON conversations (bot_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_bot_archive_recent
  ON conversations (bot_id, archived_at, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role               TEXT NOT NULL CHECK (role IN ('user','bot','operator','system')),
  content            TEXT NOT NULL,
  twilio_sid         TEXT,
  media_url          TEXT,
  media_type         TEXT,
  media_name         TEXT,
  actions            JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_sid        TEXT,
  provider_status    TEXT,
  provider_error_code TEXT,
  provider_error_message TEXT,
  status_updated_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS content_sid TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_status TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_error_code TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_error_message TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_twilio_sid
  ON messages (twilio_sid) WHERE twilio_sid IS NOT NULL;

-- I media possono risiedere nel database o in uno storage S3 compatibile.
CREATE TABLE IF NOT EXISTS media_assets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash         TEXT UNIQUE NOT NULL,
  filename           TEXT NOT NULL,
  content_type       TEXT NOT NULL,
  byte_size          INT NOT NULL,
  data               BYTEA,
  storage_provider   TEXT NOT NULL DEFAULT 'database',
  storage_key        TEXT,
  uploaded_by        TEXT,
  purpose            TEXT NOT NULL DEFAULT 'chat',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE media_assets ALTER COLUMN data DROP NOT NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'database';
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS storage_key TEXT;
CREATE INDEX IF NOT EXISTS idx_media_assets_created ON media_assets (created_at DESC);

CREATE TABLE IF NOT EXISTS documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  filename           TEXT NOT NULL,
  content_hash       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_bot ON documents (bot_id);

-- 1536 = text-embedding-3-small / ada-002. Bump if switching model.
CREATE TABLE IF NOT EXISTS chunks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  bot_id          UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  chunk_index        INT NOT NULL,
  content            TEXT NOT NULL,
  embedding          vector(1536),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chunks_bot ON chunks (bot_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS broadcast_campaigns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  template_sid       TEXT NOT NULL,
  template_name      TEXT,
  source_filename    TEXT NOT NULL,
  phone_column       TEXT NOT NULL,
  variable_mapping   JSONB NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','running','completed','completed_with_errors','failed')),
  total_count        INT NOT NULL DEFAULT 0,
  sent_count         INT NOT NULL DEFAULT 0,
  failed_count       INT NOT NULL DEFAULT 0,
  failure_reason     TEXT,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_recent
  ON broadcast_campaigns (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_bot_recent
  ON broadcast_campaigns (bot_id, created_at DESC);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        UUID NOT NULL REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
  row_number         INT NOT NULL,
  phone_number       TEXT NOT NULL,
  contact_name       TEXT,
  contact_data       JSONB NOT NULL DEFAULT '{}',
  content_variables  JSONB NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','sent','failed')),
  claimed_at         TIMESTAMPTZ,
  claim_token        UUID,
  twilio_sid         TEXT,
  error_code         TEXT,
  error_message      TEXT,
  delivery_status    TEXT,
  status_updated_at  TIMESTAMPTZ,
  sent_at            TIMESTAMPTZ,
  UNIQUE (campaign_id, row_number)
);
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS claim_token UUID;
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS delivery_status TEXT;
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
ALTER TABLE broadcast_recipients DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;
ALTER TABLE broadcast_recipients ADD CONSTRAINT broadcast_recipients_status_check
  CHECK (status IN ('pending','processing','sent','failed'));
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_pending
  ON broadcast_recipients (campaign_id, status, row_number);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_phone
  ON broadcast_recipients (phone_number, campaign_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_twilio_sid
  ON broadcast_recipients (twilio_sid) WHERE twilio_sid IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_settings (
  key                TEXT PRIMARY KEY,
  value_encrypted    TEXT NOT NULL,
  updated_by         TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username           TEXT UNIQUE NOT NULL,
  display_name       TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'whatsapp_user'
                     CHECK (role IN ('admin','whatsapp_user','crm_user')),
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash         TEXT PRIMARY KEY,
  user_id            UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at         TIMESTAMPTZ NOT NULL,
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions (expires_at);

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
UPDATE app_users
SET role = 'whatsapp_user'
WHERE role IN ('operator', 'broadcaster', 'viewer');
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check
  CHECK (role IN ('admin', 'whatsapp_user', 'crm_user'));

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bots_updated_at ON bots;
CREATE TRIGGER trg_bots_updated_at
BEFORE UPDATE ON bots
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_app_users_updated_at ON app_users;
CREATE TRIGGER trg_app_users_updated_at
BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- CRM leggero per contatti, liste dinamiche, email e sequenze.
CREATE TABLE IF NOT EXISTS crm_contact_statuses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  sort_order         INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contact_statuses_name
  ON crm_contact_statuses (lower(name));
INSERT INTO crm_contact_statuses (name, sort_order)
VALUES ('Lead',10),('Richiesta di contatto',20),('Contattato',30),('Iscritto',40),('Pagante',50)
ON CONFLICT (lower(name)) DO NOTHING;

CREATE TABLE IF NOT EXISTS crm_contacts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name         TEXT,
  last_name          TEXT,
  email              TEXT,
  email_normalized   TEXT UNIQUE,
  phone              TEXT,
  phone_normalized   TEXT UNIQUE,
  source             TEXT NOT NULL DEFAULT 'manual',
  email_status       TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (email_status IN ('unknown','subscribed','unsubscribed','bounced')),
  tags               TEXT[] NOT NULL DEFAULT '{}',
  custom_fields      JSONB NOT NULL DEFAULT '{}',
  consent_at         TIMESTAMPTZ,
  consent_source     TEXT,
  consent_proof      JSONB NOT NULL DEFAULT '{}'::jsonb,
  contact_status_id  UUID REFERENCES crm_contact_statuses(id) ON DELETE SET NULL,
  contact_type       TEXT CHECK (contact_type IS NULL OR contact_type IN ('parent','student')),
  webinar_registered_at DATE,
  utm_source         TEXT,
  utm_medium         TEXT,
  utm_campaign       TEXT,
  utm_term           TEXT,
  utm_content        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email_normalized IS NOT NULL OR phone_normalized IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_created ON crm_contacts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_source ON crm_contacts (source);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_status ON crm_contacts (email_status);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_tags ON crm_contacts USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_contact_status ON crm_contacts (contact_status_id);
ALTER TABLE crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_email_status_check;
ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_email_status_check
  CHECK (email_status IN ('unknown','subscribed','unsubscribed','bounced'));

CREATE TABLE IF NOT EXISTS crm_lists (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  description        TEXT,
  filter_json        JSONB NOT NULL DEFAULT '{}',
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_list_memberships (
  list_id            UUID NOT NULL REFERENCES crm_lists(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  source             TEXT NOT NULL DEFAULT 'manual',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_list_memberships_contact
  ON crm_list_memberships (contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_list_memberships_list_created
  ON crm_list_memberships (list_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_list_exclusions (
  list_id            UUID NOT NULL REFERENCES crm_lists(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  source             TEXT NOT NULL DEFAULT 'manual',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_list_exclusions_contact
  ON crm_list_exclusions (contact_id);

CREATE TABLE IF NOT EXISTS crm_contact_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id         UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  event_type         TEXT NOT NULL,
  event_data         JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_contact_events_contact
  ON crm_contact_events (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_content_folders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               TEXT NOT NULL CHECK (kind IN ('template','sequence')),
  name               TEXT NOT NULL,
  description        TEXT,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_content_folders_kind_name
  ON crm_content_folders (kind, lower(name));

CREATE TABLE IF NOT EXISTS crm_email_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  subject            TEXT NOT NULL,
  preheader          TEXT,
  html_body          TEXT NOT NULL,
  text_body          TEXT,
  attachments        JSONB NOT NULL DEFAULT '[]'::jsonb,
  folder_id          UUID REFERENCES crm_content_folders(id) ON DELETE SET NULL,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_sequences (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  description        TEXT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_type       TEXT NOT NULL DEFAULT 'manual',
  trigger_list_id    UUID REFERENCES crm_lists(id) ON DELETE RESTRICT,
  trigger_started_at TIMESTAMPTZ,
  trigger_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  folder_id          UUID REFERENCES crm_content_folders(id) ON DELETE SET NULL,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE crm_sequences ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE crm_sequences ADD COLUMN IF NOT EXISTS trigger_list_id UUID REFERENCES crm_lists(id) ON DELETE RESTRICT;
ALTER TABLE crm_sequences ADD COLUMN IF NOT EXISTS trigger_started_at TIMESTAMPTZ;
ALTER TABLE crm_sequences ADD COLUMN IF NOT EXISTS trigger_conditions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE crm_sequences DROP CONSTRAINT IF EXISTS crm_sequences_trigger_type_check;
ALTER TABLE crm_sequences ADD CONSTRAINT crm_sequences_trigger_type_check
  CHECK (trigger_type IN ('manual','list_joined'));
ALTER TABLE crm_sequences DROP CONSTRAINT IF EXISTS crm_sequences_trigger_configuration_check;
ALTER TABLE crm_sequences ADD CONSTRAINT crm_sequences_trigger_configuration_check
  CHECK (
    (trigger_type = 'manual' AND trigger_list_id IS NULL AND trigger_started_at IS NULL)
    OR
    (trigger_type = 'list_joined' AND trigger_list_id IS NOT NULL AND trigger_started_at IS NOT NULL)
  );
ALTER TABLE crm_sequences DROP CONSTRAINT IF EXISTS crm_sequences_trigger_conditions_check;
ALTER TABLE crm_sequences ADD CONSTRAINT crm_sequences_trigger_conditions_check
  CHECK (jsonb_typeof(trigger_conditions) = 'array');
CREATE INDEX IF NOT EXISTS idx_crm_sequences_trigger_list
  ON crm_sequences (trigger_list_id) WHERE trigger_type = 'list_joined';
CREATE INDEX IF NOT EXISTS idx_crm_email_templates_folder
  ON crm_email_templates (folder_id);
CREATE INDEX IF NOT EXISTS idx_crm_sequences_folder
  ON crm_sequences (folder_id);

CREATE TABLE IF NOT EXISTS crm_sequence_steps (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id        UUID NOT NULL REFERENCES crm_sequences(id) ON DELETE CASCADE,
  position           INT NOT NULL CHECK (position >= 0),
  delay_minutes      INT NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  template_id        UUID NOT NULL REFERENCES crm_email_templates(id) ON DELETE RESTRICT,
  UNIQUE (sequence_id, position)
);

CREATE TABLE IF NOT EXISTS crm_sequence_enrollments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id        UUID NOT NULL REFERENCES crm_sequences(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','paused','completed','failed','cancelled')),
  current_step       INT NOT NULL DEFAULT -1,
  next_run_at        TIMESTAMPTZ,
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_enrollments_due
  ON crm_sequence_enrollments (status, next_run_at);
ALTER TABLE crm_sequence_enrollments DROP CONSTRAINT IF EXISTS crm_sequence_enrollments_status_check;
ALTER TABLE crm_sequence_enrollments ADD CONSTRAINT crm_sequence_enrollments_status_check
  CHECK (status IN ('active','paused','completed','failed','cancelled'));

CREATE TABLE IF NOT EXISTS crm_sequence_trigger_state (
  sequence_id        UUID NOT NULL REFERENCES crm_sequences(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  is_member          BOOLEAN NOT NULL,
  observed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sequence_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_sequence_trigger_state_member
  ON crm_sequence_trigger_state (sequence_id, is_member);

CREATE TABLE IF NOT EXISTS crm_email_campaigns (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  list_id            UUID REFERENCES crm_lists(id) ON DELETE SET NULL,
  template_id        UUID REFERENCES crm_email_templates(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','running','completed','completed_with_errors','failed')),
  total_count        INT NOT NULL DEFAULT 0,
  sent_count         INT NOT NULL DEFAULT 0,
  failed_count       INT NOT NULL DEFAULT 0,
  scheduled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_crm_campaigns_recent ON crm_email_campaigns (created_at DESC);

CREATE TABLE IF NOT EXISTS crm_email_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               TEXT NOT NULL CHECK (kind IN ('campaign','sequence')),
  campaign_id        UUID REFERENCES crm_email_campaigns(id) ON DELETE CASCADE,
  enrollment_id      UUID REFERENCES crm_sequence_enrollments(id) ON DELETE CASCADE,
  sequence_step_id   UUID REFERENCES crm_sequence_steps(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  template_id        UUID NOT NULL REFERENCES crm_email_templates(id) ON DELETE RESTRICT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  scheduled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts           INT NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error         TEXT,
  claimed_at         TIMESTAMPTZ,
  claim_token        UUID,
  sent_at            TIMESTAMPTZ,
  open_count         INT NOT NULL DEFAULT 0,
  first_opened_at    TIMESTAMPTZ,
  last_opened_at     TIMESTAMPTZ,
  click_count        INT NOT NULL DEFAULT 0,
  first_clicked_at   TIMESTAMPTZ,
  last_clicked_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, sequence_step_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_email_jobs_due ON crm_email_jobs (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_crm_email_jobs_campaign ON crm_email_jobs (campaign_id, status);
ALTER TABLE crm_email_jobs DROP CONSTRAINT IF EXISTS crm_email_jobs_status_check;
ALTER TABLE crm_email_jobs ADD CONSTRAINT crm_email_jobs_status_check
  CHECK (status IN ('pending','sending','sent','failed','cancelled'));

CREATE TABLE IF NOT EXISTS crm_email_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             UUID NOT NULL REFERENCES crm_email_jobs(id) ON DELETE CASCADE,
  event_type         TEXT NOT NULL CHECK (event_type IN ('open','click')),
  url                TEXT,
  user_agent         TEXT,
  ip                 TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_email_events_job ON crm_email_events (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_email_events_type ON crm_email_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_api_keys (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  source             TEXT NOT NULL,
  key_prefix         TEXT NOT NULL,
  key_hash           TEXT UNIQUE NOT NULL,
  scopes             TEXT[] NOT NULL DEFAULT ARRAY['contacts:write']::TEXT[],
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at       TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_crm_api_keys_active ON crm_api_keys (active, source);

CREATE TABLE IF NOT EXISTS crm_ingest_requests (
  api_key_id          UUID REFERENCES crm_api_keys(id) ON DELETE CASCADE,
  legacy_source       TEXT,
  idempotency_key_hash TEXT NOT NULL,
  request_hash        TEXT NOT NULL,
  response_json       JSONB,
  status_code         INT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  CHECK (api_key_id IS NOT NULL OR legacy_source IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_ingest_requests_key
  ON crm_ingest_requests (COALESCE(api_key_id::text, 'legacy:' || legacy_source), idempotency_key_hash);

DROP TRIGGER IF EXISTS trg_crm_contacts_updated_at ON crm_contacts;
CREATE TRIGGER trg_crm_contacts_updated_at BEFORE UPDATE ON crm_contacts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_crm_lists_updated_at ON crm_lists;
CREATE TRIGGER trg_crm_lists_updated_at BEFORE UPDATE ON crm_lists
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_crm_templates_updated_at ON crm_email_templates;
CREATE TRIGGER trg_crm_templates_updated_at BEFORE UPDATE ON crm_email_templates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_crm_content_folders_updated_at ON crm_content_folders;
CREATE TRIGGER trg_crm_content_folders_updated_at BEFORE UPDATE ON crm_content_folders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_crm_sequences_updated_at ON crm_sequences;
CREATE TRIGGER trg_crm_sequences_updated_at BEFORE UPDATE ON crm_sequences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_crm_enrollments_updated_at ON crm_sequence_enrollments;
CREATE TRIGGER trg_crm_enrollments_updated_at BEFORE UPDATE ON crm_sequence_enrollments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
