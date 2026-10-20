WITH eligible_campaigns AS MATERIALIZED (
  SELECT campaign.id
  FROM crm_email_campaigns campaign
  WHERE campaign.scheduled_at > now()
    AND (
      campaign.status = 'queued'
      OR (campaign.status = 'completed' AND campaign.total_count = 0)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM crm_email_jobs job
      WHERE job.campaign_id = campaign.id
        AND job.status <> 'pending'
    )
), removed_jobs AS (
  DELETE FROM crm_email_jobs job
  WHERE job.campaign_id IN (SELECT id FROM eligible_campaigns)
  RETURNING job.campaign_id
)
UPDATE crm_email_campaigns campaign
SET recipients_materialized_at = NULL,
    status = 'queued',
    completed_at = NULL
WHERE campaign.id IN (SELECT id FROM eligible_campaigns);
