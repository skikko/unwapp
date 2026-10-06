CREATE TABLE IF NOT EXISTS crm_automations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  description        TEXT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_type       TEXT NOT NULL CHECK (trigger_type IN ('contact_saved','list_joined')),
  trigger_list_id    UUID REFERENCES crm_lists(id) ON DELETE RESTRICT,
  trigger_condition  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (trigger_type = 'contact_saved' AND trigger_list_id IS NULL AND jsonb_typeof(trigger_condition) = 'object')
    OR
    (trigger_type = 'list_joined' AND trigger_list_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_crm_automations_trigger
  ON crm_automations (trigger_type, active);
CREATE INDEX IF NOT EXISTS idx_crm_automations_trigger_list
  ON crm_automations (trigger_list_id) WHERE trigger_type='list_joined';

CREATE TABLE IF NOT EXISTS crm_automation_actions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id      UUID NOT NULL REFERENCES crm_automations(id) ON DELETE CASCADE,
  position           INT NOT NULL CHECK (position >= 0),
  action_type        TEXT NOT NULL CHECK (action_type IN ('add_to_list','notify_email')),
  target_list_id     UUID REFERENCES crm_lists(id) ON DELETE RESTRICT,
  to_email           TEXT,
  subject            TEXT,
  body               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (automation_id, position),
  CHECK (
    (action_type = 'add_to_list' AND target_list_id IS NOT NULL AND to_email IS NULL)
    OR
    (action_type = 'notify_email' AND to_email IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS crm_automation_trigger_state (
  automation_id      UUID NOT NULL REFERENCES crm_automations(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  is_match           BOOLEAN NOT NULL,
  observed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_automation_state_match
  ON crm_automation_trigger_state (automation_id, is_match);

CREATE TABLE IF NOT EXISTS crm_automation_notifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id      UUID NOT NULL REFERENCES crm_automations(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  to_email           TEXT NOT NULL,
  subject            TEXT NOT NULL,
  body               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  scheduled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts           INT NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error         TEXT,
  claimed_at         TIMESTAMPTZ,
  claim_token        UUID,
  sent_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_automation_notifications_due
  ON crm_automation_notifications (status, scheduled_at);

DROP TRIGGER IF EXISTS trg_crm_automations_updated_at ON crm_automations;
CREATE TRIGGER trg_crm_automations_updated_at
BEFORE UPDATE ON crm_automations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
