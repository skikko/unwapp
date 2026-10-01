-- Aggiunge archivio e stato di lettura persistente alle conversazioni WhatsApp.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unread_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_unread_count_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_unread_count_check
  CHECK (unread_count >= 0);

CREATE INDEX IF NOT EXISTS idx_conversations_bot_archive_recent
  ON conversations (bot_id, archived_at, last_message_at DESC);
