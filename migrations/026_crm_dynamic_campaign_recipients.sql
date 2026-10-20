ALTER TABLE crm_email_campaigns
  ADD COLUMN IF NOT EXISTS recipients_materialized_at TIMESTAMPTZ;

UPDATE crm_email_campaigns
SET recipients_materialized_at = COALESCE(created_at, now())
WHERE recipients_materialized_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_crm_campaigns_due_materialization
  ON crm_email_campaigns (scheduled_at, created_at)
  WHERE recipients_materialized_at IS NULL;
