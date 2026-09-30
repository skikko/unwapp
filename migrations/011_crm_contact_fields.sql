CREATE TABLE IF NOT EXISTS crm_contact_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contact_statuses_name
  ON crm_contact_statuses (lower(name));

INSERT INTO crm_contact_statuses (name, sort_order)
VALUES
  ('Lead', 10),
  ('Richiesta di contatto', 20),
  ('Contattato', 30),
  ('Iscritto', 40),
  ('Pagante', 50)
ON CONFLICT (lower(name)) DO NOTHING;

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS contact_status_id UUID REFERENCES crm_contact_statuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_type TEXT,
  ADD COLUMN IF NOT EXISTS webinar_registered_at DATE,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT;

ALTER TABLE crm_contacts
  DROP CONSTRAINT IF EXISTS crm_contacts_contact_type_check;
ALTER TABLE crm_contacts
  ADD CONSTRAINT crm_contacts_contact_type_check
  CHECK (contact_type IS NULL OR contact_type IN ('parent','student'));

CREATE INDEX IF NOT EXISTS idx_crm_contacts_contact_status
  ON crm_contacts (contact_status_id);
