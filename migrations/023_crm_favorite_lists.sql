ALTER TABLE crm_lists
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_crm_lists_favorite_updated
  ON crm_lists (is_favorite DESC, updated_at DESC);
