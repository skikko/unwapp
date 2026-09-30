ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS claim_token UUID;

ALTER TABLE broadcast_recipients
  DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;

ALTER TABLE broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed'));
