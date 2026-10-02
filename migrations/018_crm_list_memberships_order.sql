CREATE INDEX IF NOT EXISTS idx_crm_list_memberships_list_created
  ON crm_list_memberships (list_id, created_at DESC);
