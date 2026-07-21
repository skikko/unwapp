BEGIN;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS content_sid TEXT;

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INT NOT NULL,
  data BYTEA NOT NULL,
  uploaded_by TEXT,
  purpose TEXT NOT NULL DEFAULT 'chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_created ON media_assets (created_at DESC);

COMMIT;
