BEGIN;

DO $$
DECLARE old_table TEXT := 'cour' || 'ses';
BEGIN
  IF to_regclass('public.' || old_table) IS NOT NULL AND to_regclass('public.bots') IS NULL THEN
    EXECUTE format('ALTER TABLE %I RENAME TO bots', old_table);
  END IF;
END $$;

DO $$
DECLARE
  table_name TEXT;
  old_column TEXT := 'cour' || 'se_id';
BEGIN
  FOREACH table_name IN ARRAY ARRAY['conversations', 'documents', 'chunks'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND information_schema.columns.table_name = table_name
        AND column_name = old_column
    ) THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO bot_id', table_name, old_column);
    END IF;
  END LOOP;
END $$;

ALTER TABLE bots ADD COLUMN IF NOT EXISTS ai_api_key_encrypted TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents'
      AND column_name = ('g' || 'cs_uri')
  ) THEN
    EXECUTE 'ALTER TABLE documents DROP COLUMN ' || quote_ident('g' || 'cs_uri');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS broadcast_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  template_sid TEXT NOT NULL,
  template_name TEXT,
  source_filename TEXT NOT NULL,
  phone_column TEXT NOT NULL,
  variable_mapping JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','completed_with_errors','failed')),
  total_count INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  failure_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  phone_number TEXT NOT NULL,
  contact_data JSONB NOT NULL DEFAULT '{}',
  content_variables JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  twilio_sid TEXT,
  error_code TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  UNIQUE (campaign_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_campaigns_recent
  ON broadcast_campaigns (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_pending
  ON broadcast_recipients (campaign_id, status, row_number);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_encrypted TEXT NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','operator','broadcaster','viewer')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions (expires_at);

COMMIT;
