const db = require('../config/db');

async function upsert(botId, phoneNumber) {
  const { rows } = await db.query(
    `INSERT INTO conversations (bot_id, phone_number, contact_name)
     VALUES ($1, $2, (
       SELECT br.contact_name
       FROM broadcast_recipients br
       JOIN broadcast_campaigns bc ON bc.id = br.campaign_id
       WHERE bc.bot_id = $1
         AND br.phone_number = $2
         AND NULLIF(BTRIM(br.contact_name), '') IS NOT NULL
       ORDER BY bc.created_at DESC, br.row_number DESC
       LIMIT 1
     ))
     ON CONFLICT (bot_id, phone_number)
     DO UPDATE SET last_message_at = now(),
                   contact_name = COALESCE(EXCLUDED.contact_name, conversations.contact_name)
     RETURNING *`,
    [botId, phoneNumber]
  );
  return rows[0];
}

async function touch(id) {
  await db.query(
    `UPDATE conversations SET last_message_at = now() WHERE id = $1`,
    [id]
  );
}

async function getById(id) {
  const { rows } = await db.query(
    `SELECT * FROM conversations WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

function parseBroadcastFilter(value) {
  const raw = String(value || '');
  if (raw.startsWith('template:') && /^HX[a-fA-F0-9]{32}$/.test(raw.slice(9))) {
    return { type: 'template', value: raw.slice(9) };
  }
  if (raw.startsWith('campaign:') && /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(raw.slice(9))) {
    return { type: 'campaign', value: raw.slice(9) };
  }
  return { type: '', value: '' };
}

async function listByBot(botId, {
  limit = 100, search = '', status = '', broadcast = '', archived = false,
} = {}) {
  const normalizedSearch = String(search || '').trim().slice(0, 120);
  const normalizedStatus = ['active', 'human', 'closed'].includes(status) ? status : '';
  const broadcastFilter = parseBroadcastFilter(broadcast);
  const { rows } = await db.query(
    `SELECT c.*,
            (SELECT content FROM messages m
             WHERE m.conversation_id = c.id
             ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT count(*) FROM messages m
             WHERE m.conversation_id = c.id) AS message_count,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'sid', linked.template_sid,
                'name', linked.template_name,
                'last_sent_at', linked.last_sent_at
              ) ORDER BY linked.last_sent_at DESC)
              FROM (
                SELECT bc.template_sid,
                       COALESCE(bc.template_name, bc.template_sid) AS template_name,
                       max(COALESCE(br.sent_at, bc.created_at)) AS last_sent_at
                FROM broadcast_recipients br
                JOIN broadcast_campaigns bc ON bc.id = br.campaign_id
                WHERE bc.bot_id = c.bot_id AND br.phone_number = c.phone_number
                GROUP BY bc.template_sid, COALESCE(bc.template_name, bc.template_sid)
              ) linked
            ), '[]'::jsonb) AS broadcast_templates
     FROM conversations c
     WHERE c.bot_id = $1
       AND ($2::text = '' OR c.phone_number ILIKE '%' || $2 || '%'
         OR c.contact_name ILIKE '%' || $2 || '%'
         OR EXISTS (SELECT 1 FROM messages sm WHERE sm.conversation_id = c.id AND sm.content ILIKE '%' || $2 || '%')
         OR EXISTS (
           SELECT 1 FROM broadcast_recipients sbr
           JOIN broadcast_campaigns sbc ON sbc.id = sbr.campaign_id
           WHERE sbc.bot_id = c.bot_id AND sbr.phone_number = c.phone_number
             AND COALESCE(sbc.template_name, sbc.template_sid) ILIKE '%' || $2 || '%'
         ))
       AND ($3::text = '' OR c.status = $3)
       AND (($6::boolean = TRUE AND c.archived_at IS NOT NULL)
         OR ($6::boolean = FALSE AND c.archived_at IS NULL))
       AND ($4::text = ''
         OR ($4::text = 'template' AND EXISTS (
           SELECT 1 FROM broadcast_recipients fbr
           JOIN broadcast_campaigns fbc ON fbc.id = fbr.campaign_id
           WHERE fbc.bot_id = c.bot_id AND fbr.phone_number = c.phone_number AND fbc.template_sid = $5
         ))
         OR ($4::text = 'campaign' AND EXISTS (
           SELECT 1 FROM broadcast_recipients fbr
           JOIN broadcast_campaigns fbc ON fbc.id = fbr.campaign_id
           WHERE fbc.bot_id = c.bot_id AND fbr.phone_number = c.phone_number AND fbc.id::text = $5
         )))
     ORDER BY c.last_message_at DESC
     LIMIT $7`,
    [botId, normalizedSearch, normalizedStatus, broadcastFilter.type, broadcastFilter.value, Boolean(archived), limit]
  );
  return rows;
}

async function listFiltersByBot(botId, { campaignLimit = 30 } = {}) {
  const [templatesResult, campaignsResult] = await Promise.all([
    db.query(
      `SELECT bc.template_sid AS sid,
              max(COALESCE(bc.template_name, bc.template_sid)) AS name,
              max(bc.created_at) AS last_used_at
       FROM broadcast_campaigns bc
       WHERE bc.bot_id = $1
       GROUP BY bc.template_sid
       ORDER BY max(bc.created_at) DESC`,
      [botId]
    ),
    db.query(
      `SELECT id, template_sid, COALESCE(template_name, template_sid) AS name,
              source_filename, created_at
       FROM broadcast_campaigns
       WHERE bot_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [botId, campaignLimit]
    ),
  ]);
  return { templates: templatesResult.rows, campaigns: campaignsResult.rows };
}

async function remove(id) {
  const { rows } = await db.query(
    `DELETE FROM conversations WHERE id = $1 RETURNING id, bot_id, phone_number`,
    [id]
  );
  return rows[0] || null;
}

async function setOperator(id, email) {
  const { rows } = await db.query(
    `UPDATE conversations
     SET status = CASE WHEN $2::text IS NULL THEN 'active' ELSE 'human' END,
         operator_email = $2
     WHERE id = $1
     RETURNING *`,
    [id, email]
  );
  return rows[0] || null;
}

async function setStatus(id, status) {
  const { rows } = await db.query(
    `UPDATE conversations SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return rows[0] || null;
}

async function setArchived(id, archived) {
  const { rows } = await db.query(
    `UPDATE conversations
     SET archived_at=CASE WHEN $2::boolean THEN now() ELSE NULL END
     WHERE id=$1 RETURNING *`,
    [id, Boolean(archived)]
  );
  return rows[0] || null;
}

async function setUnread(id, unread) {
  const { rows } = await db.query(
    `UPDATE conversations SET
       unread_count=CASE WHEN $2::boolean THEN GREATEST(unread_count,1) ELSE 0 END,
       last_read_at=CASE WHEN $2::boolean THEN last_read_at ELSE now() END
     WHERE id=$1 RETURNING *`,
    [id, Boolean(unread)]
  );
  return rows[0] || null;
}

async function setManualByBot(botId) {
  const { rowCount } = await db.query(
    `UPDATE conversations
     SET status = 'human'
     WHERE bot_id = $1 AND status = 'active'`,
    [botId]
  );
  return rowCount;
}

module.exports = {
  upsert,
  touch,
  getById,
  listByBot,
  listFiltersByBot,
  parseBroadcastFilter,
  setOperator,
  setStatus,
  setArchived,
  setUnread,
  setManualByBot,
  remove,
};
