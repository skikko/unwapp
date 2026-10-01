ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS provider_error_code TEXT,
  ADD COLUMN IF NOT EXISTS provider_error_message TEXT;
