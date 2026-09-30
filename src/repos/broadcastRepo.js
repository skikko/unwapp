const db = require('../config/db');

async function createCampaign(input, contacts) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO broadcast_campaigns
       (bot_id, template_sid, template_name, source_filename, phone_column,
        variable_mapping, total_count, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8)
       RETURNING *`,
      [input.botId, input.templateSid, input.templateName || null,
       input.sourceFilename, input.phoneColumn, input.variableMapping || {},
       contacts.length, input.createdBy]
    );
    const campaign = rows[0];
    for (const contact of contacts) {
      await client.query(
        `INSERT INTO broadcast_recipients
         (campaign_id, row_number, phone_number, contact_name, contact_data, content_variables)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [campaign.id, contact.rowNumber, contact.phone, contact.contactName || null,
         contact.data, contact.variables]
      );
    }
    await client.query(
      `UPDATE conversations c
       SET contact_name = br.contact_name
       FROM broadcast_recipients br
       WHERE br.campaign_id = $1
         AND c.bot_id = $2
         AND c.phone_number = br.phone_number
         AND NULLIF(BTRIM(br.contact_name), '') IS NOT NULL`,
      [campaign.id, input.botId]
    );
    await client.query('COMMIT');
    return campaign;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listCampaigns({ limit = 30 } = {}) {
  const { rows } = await db.query(
    `SELECT bc.*, c.name AS bot_name
     FROM broadcast_campaigns bc
     JOIN bots c ON c.id = bc.bot_id
     ORDER BY bc.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function getCampaign(id) {
  const { rows } = await db.query(
    `SELECT bc.*, c.name AS bot_name, c.twilio_number
     FROM broadcast_campaigns bc
     JOIN bots c ON c.id = bc.bot_id
     WHERE bc.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function listRecipients(campaignId, { limit = 200 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM broadcast_recipients
     WHERE campaign_id = $1
     ORDER BY row_number ASC LIMIT $2`,
    [campaignId, limit]
  );
  return rows;
}

async function claimNextRecipient(campaignId) {
  const { rows } = await db.query(
    `WITH next_recipient AS (
       SELECT id
       FROM broadcast_recipients
       WHERE campaign_id = $1 AND status = 'pending'
       ORDER BY row_number ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE broadcast_recipients recipient
     SET status = 'processing',
         claimed_at = now(),
         claim_token = gen_random_uuid(),
         error_code = NULL,
         error_message = NULL
     FROM next_recipient
     WHERE recipient.id = next_recipient.id
     RETURNING recipient.*`,
    [campaignId]
  );
  return rows[0] || null;
}

async function failStaleClaims(timeoutMinutes) {
  const { rowCount } = await db.query(
    `UPDATE broadcast_recipients
     SET status = 'failed',
         error_code = 'worker_interrupted',
         error_message = 'Delivery outcome unknown after worker interruption'
     WHERE status = 'processing'
       AND claimed_at < now() - ($1 * interval '1 minute')`,
    [timeoutMinutes]
  );
  return rowCount;
}

async function verifyClaimSchema() {
  await db.query(
    `SELECT claimed_at, claim_token
     FROM broadcast_recipients
     LIMIT 0`
  );
}

async function markRunning(id) {
  await db.query(
    `UPDATE broadcast_campaigns
     SET status = 'running', started_at = COALESCE(started_at, now()), completed_at = NULL
     WHERE id = $1 AND status IN ('queued','running')`,
    [id]
  );
}

async function markRecipientSent(id, claimToken, twilioSid) {
  const { rowCount } = await db.query(
    `UPDATE broadcast_recipients
     SET status = 'sent', twilio_sid = $3, sent_at = now()
     WHERE id = $1 AND claim_token = $2 AND status = 'processing'`,
    [id, claimToken, twilioSid]
  );
  return rowCount === 1;
}

async function markRecipientFailed(id, claimToken, error) {
  const { rowCount } = await db.query(
    `UPDATE broadcast_recipients
     SET status = 'failed', error_code = $3, error_message = $4
     WHERE id = $1 AND claim_token = $2 AND status = 'processing'`,
    [id, claimToken, error.code ? String(error.code) : null, String(error.message || error).slice(0, 1000)]
  );
  return rowCount === 1;
}

async function refreshCounts(campaignId) {
  const { rows } = await db.query(
    `UPDATE broadcast_campaigns bc SET
       sent_count = counts.sent,
       failed_count = counts.failed
     FROM (
       SELECT campaign_id,
              count(*) FILTER (WHERE status = 'sent')::int AS sent,
              count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM broadcast_recipients WHERE campaign_id = $1 GROUP BY campaign_id
     ) counts
     WHERE bc.id = counts.campaign_id
     RETURNING bc.*`,
    [campaignId]
  );
  return rows[0] || null;
}

async function markCompletedIfIdle(id) {
  const { rows } = await db.query(
    `WITH counts AS (
       SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent,
              count(*) FILTER (WHERE status = 'failed')::int AS failed,
              count(*) FILTER (WHERE status IN ('pending', 'processing'))::int AS active
       FROM broadcast_recipients
       WHERE campaign_id = $1
     )
     UPDATE broadcast_campaigns campaign
     SET sent_count = counts.sent,
         failed_count = counts.failed,
         status = CASE WHEN counts.failed > 0 THEN 'completed_with_errors' ELSE 'completed' END,
         completed_at = now()
     FROM counts
     WHERE campaign.id = $1 AND counts.active = 0
     RETURNING campaign.*`,
    [id]
  );
  return rows[0] || null;
}

async function pendingCampaignIds() {
  const { rows } = await db.query(
    `SELECT id FROM broadcast_campaigns WHERE status IN ('queued','running') ORDER BY created_at ASC`
  );
  return rows.map((row) => row.id);
}

async function updateDeliveryStatus(twilioSid, status, errorCode = null, errorMessage = null) {
  const { rows } = await db.query(
    `UPDATE broadcast_recipients SET
       delivery_status=$2,status_updated_at=now(),
       error_code=COALESCE($3,error_code),error_message=COALESCE($4,error_message)
     WHERE twilio_sid=$1 RETURNING *`,
    [twilioSid, status, errorCode, errorMessage]
  );
  return rows[0] || null;
}

module.exports = {
  createCampaign, listCampaigns, getCampaign, listRecipients,
  claimNextRecipient, failStaleClaims, verifyClaimSchema, markRunning,
  markRecipientSent, markRecipientFailed, refreshCounts, markCompletedIfIdle,
  pendingCampaignIds,
  updateDeliveryStatus,
};
