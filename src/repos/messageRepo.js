const db = require('../config/db');

async function add(conversationId, role, content, twilioSid = null) {
  const { rows } = await db.query(
    `INSERT INTO messages (conversation_id, role, content, twilio_sid)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [conversationId, role, content, twilioSid]
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
