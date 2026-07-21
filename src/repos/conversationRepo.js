const db = require('../config/db');

async function upsert(botId, phoneNumber) {
  const { rows } = await db.query(
    `INSERT INTO conversations (bot_id, phone_number)
     VALUES ($1, $2)
     ON CONFLICT (bot_id, phone_number)
     DO UPDATE SET last_message_at = now()
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

async function listByBot(botId, { limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT c.*,
            (SELECT content FROM messages m
             WHERE m.conversation_id = c.id
             ORDER BY created_at DESC LIMIT 1) AS last_message,
            (SELECT count(*) FROM messages m
             WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c
     WHERE c.bot_id = $1
     ORDER BY c.last_message_at DESC
     LIMIT $2`,
    [botId, limit]
  );
  return rows;
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

module.exports = {
  upsert,
  touch,
  getById,
  listByBot,
  setOperator,
  setStatus,
};
