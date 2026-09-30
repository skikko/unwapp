-- Consente di aggiungere manualmente contatti alle liste dinamiche.

CREATE TABLE IF NOT EXISTS crm_list_memberships (
  list_id      UUID NOT NULL REFERENCES crm_lists(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  source       TEXT NOT NULL DEFAULT 'manual',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_list_memberships_contact
  ON crm_list_memberships (contact_id);
