CREATE TABLE IF NOT EXISTS crm_email_campaign_lists (
  campaign_id UUID NOT NULL REFERENCES crm_email_campaigns(id) ON DELETE CASCADE,
  list_id     UUID NOT NULL REFERENCES crm_lists(id) ON DELETE RESTRICT,
  mode        TEXT NOT NULL CHECK (mode IN ('include', 'exclude')),
  PRIMARY KEY (campaign_id, list_id, mode)
);

CREATE INDEX IF NOT EXISTS idx_crm_campaign_lists_list
  ON crm_email_campaign_lists (list_id, mode, campaign_id);

INSERT INTO crm_email_campaign_lists (campaign_id, list_id, mode)
SELECT id, list_id, 'include'
FROM crm_email_campaigns
WHERE list_id IS NOT NULL
ON CONFLICT DO NOTHING;
