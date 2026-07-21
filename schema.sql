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
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  ai_api_key_encrypted TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE bots ADD COLUMN IF NOT EXISTS ai_api_key_encrypted TEXT;

CREATE TABLE IF NOT EXISTS conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  phone_number       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  operator_email     TEXT,
  last_message_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_id, phone_number)
);
CREATE INDEX IF NOT EXISTS idx_conversations_bot_recent
  ON conversations (bot_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_bot_status_recent
  ON conversations (bot_id, status, last_message_at DESC);

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
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS content_sid TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, created_at);

-- Media are stored in PostgreSQL for the initial Render deployment. Public
-- access uses an unguessable token whose hash alone is persisted here.
CREATE TABLE IF NOT EXISTS media_assets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash         TEXT UNIQUE NOT NULL,
  filename           TEXT NOT NULL,
  content_type       TEXT NOT NULL,
  byte_size          INT NOT NULL,
  data               BYTEA NOT NULL,
  uploaded_by        TEXT,
  purpose            TEXT NOT NULL DEFAULT 'chat',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
  contact_data       JSONB NOT NULL DEFAULT '{}',
  content_variables  JSONB NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sent','failed')),
  twilio_sid         TEXT,
  error_code         TEXT,
  error_message      TEXT,
  sent_at            TIMESTAMPTZ,
  UNIQUE (campaign_id, row_number)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_pending
  ON broadcast_recipients (campaign_id, status, row_number);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_phone
  ON broadcast_recipients (phone_number, campaign_id);

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
  role               TEXT NOT NULL DEFAULT 'viewer'
                     CHECK (role IN ('admin','operator','broadcaster','viewer')),
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
