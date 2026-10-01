ALTER TABLE crm_email_jobs
  ADD COLUMN IF NOT EXISTS open_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS click_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_clicked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;

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
