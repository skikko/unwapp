const db = require('../config/db');

async function add(conversationId, role, content, twilioSid = null, metadata = {}) {
  const { rows } = await db.query(
    `INSERT INTO messages
     (conversation_id, role, content, twilio_sid, media_url, media_type, media_name, actions, content_sid)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     RETURNING *`,
    [conversationId, role, content, twilioSid,
      metadata.mediaUrl || null, metadata.mediaType || null, metadata.mediaName || null,
      JSON.stringify(Array.isArray(metadata.actions) ? metadata.actions : []),
      metadata.contentSid || null]
  );
  await db.query(
    `UPDATE conversations SET last_message_at = now() WHERE id = $1`,
    [conversationId]
  );
  return rows[0];
}

async function listByConversation(conversationId, { limit = 500 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, limit]
  );
  return rows;
}

async function remove(id) {
  const { rows } = await db.query(
    `DELETE FROM messages WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function recentHistoryText(conversationId, n = 20) {
  const { rows } = await db.query(
    `SELECT role, content FROM (
       SELECT role, content, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2
     ) sub
     ORDER BY created_at ASC`,
    [conversationId, n]
  );
  return rows
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');
}

module.exports = {
  add,
  listByConversation,
  remove,
  recentHistoryText,
};
