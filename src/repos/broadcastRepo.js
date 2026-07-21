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
         (campaign_id, row_number, phone_number, contact_data, content_variables)
         VALUES ($1,$2,$3,$4,$5)`,
        [campaign.id, contact.rowNumber, contact.phone, contact.data, contact.variables]
      );
    }
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

async function nextPendingRecipient(campaignId) {
  const { rows } = await db.query(
    `SELECT * FROM broadcast_recipients
     WHERE campaign_id = $1 AND status = 'pending'
     ORDER BY row_number ASC LIMIT 1`,
    [campaignId]
  );
  return rows[0] || null;
}

async function markRunning(id) {
  await db.query(
    `UPDATE broadcast_campaigns
     SET status = 'running', started_at = COALESCE(started_at, now()), completed_at = NULL
     WHERE id = $1 AND status IN ('queued','running')`,
    [id]
  );
}

async function markRecipientSent(id, twilioSid) {
  await db.query(
    `UPDATE broadcast_recipients
     SET status = 'sent', twilio_sid = $2, sent_at = now()
     WHERE id = $1`,
    [id, twilioSid]
  );
}

async function markRecipientFailed(id, error) {
  await db.query(
    `UPDATE broadcast_recipients
     SET status = 'failed', error_code = $2, error_message = $3
     WHERE id = $1`,
    [id, error.code ? String(error.code) : null, String(error.message || error).slice(0, 1000)]
  );
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

async function markCompleted(id) {
  await refreshCounts(id);
  const { rows } = await db.query(
    `UPDATE broadcast_campaigns
     SET status = CASE WHEN failed_count > 0 THEN 'completed_with_errors' ELSE 'completed' END,
         completed_at = now()
     WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0];
}

async function markFailed(id, message) {
  await db.query(
    `UPDATE broadcast_campaigns
     SET status = 'failed', failure_reason = $2, completed_at = now()
     WHERE id = $1`,
    [id, String(message || '').slice(0, 1000)]
  );
}

async function pendingCampaignIds() {
  const { rows } = await db.query(
    `SELECT id FROM broadcast_campaigns WHERE status IN ('queued','running') ORDER BY created_at ASC`
  );
  return rows.map((row) => row.id);
}

module.exports = {
  createCampaign, listCampaigns, getCampaign, listRecipients,
  nextPendingRecipient, markRunning, markRecipientSent, markRecipientFailed,
  refreshCounts, markCompleted, markFailed, pendingCampaignIds,
};
