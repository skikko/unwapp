-- CRM leggero per contatti, liste dinamiche, email e sequenze.

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
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email_normalized IS NOT NULL OR phone_normalized IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_created ON crm_contacts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_source ON crm_contacts (source);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_status ON crm_contacts (email_status);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_tags ON crm_contacts USING GIN (tags);
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

CREATE TABLE IF NOT EXISTS crm_email_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  subject            TEXT NOT NULL,
  preheader          TEXT,
  html_body          TEXT NOT NULL,
  text_body          TEXT,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_sequences (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  description        TEXT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
                     CHECK (status IN ('active','completed','failed','cancelled')),
  current_step       INT NOT NULL DEFAULT -1,
  next_run_at        TIMESTAMPTZ,
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_enrollments_due
  ON crm_sequence_enrollments (status, next_run_at);

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
CREATE INDEX IF NOT EXISTS idx_crm_campaigns_recent
  ON crm_email_campaigns (created_at DESC);

CREATE TABLE IF NOT EXISTS crm_email_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               TEXT NOT NULL CHECK (kind IN ('campaign','sequence')),
  campaign_id        UUID REFERENCES crm_email_campaigns(id) ON DELETE CASCADE,
  enrollment_id      UUID REFERENCES crm_sequence_enrollments(id) ON DELETE CASCADE,
  sequence_step_id   UUID REFERENCES crm_sequence_steps(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  template_id        UUID NOT NULL REFERENCES crm_email_templates(id) ON DELETE RESTRICT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sending','sent','failed')),
  scheduled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts           INT NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error         TEXT,
  sent_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, sequence_step_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_email_jobs_due
  ON crm_email_jobs (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_crm_email_jobs_campaign
  ON crm_email_jobs (campaign_id, status);

DROP TRIGGER IF EXISTS trg_crm_contacts_updated_at ON crm_contacts;
CREATE TRIGGER trg_crm_contacts_updated_at
BEFORE UPDATE ON crm_contacts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_crm_lists_updated_at ON crm_lists;
CREATE TRIGGER trg_crm_lists_updated_at
BEFORE UPDATE ON crm_lists
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_crm_templates_updated_at ON crm_email_templates;
CREATE TRIGGER trg_crm_templates_updated_at
BEFORE UPDATE ON crm_email_templates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_crm_sequences_updated_at ON crm_sequences;
CREATE TRIGGER trg_crm_sequences_updated_at
BEFORE UPDATE ON crm_sequences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_crm_enrollments_updated_at ON crm_sequence_enrollments;
CREATE TRIGGER trg_crm_enrollments_updated_at
BEFORE UPDATE ON crm_sequence_enrollments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
