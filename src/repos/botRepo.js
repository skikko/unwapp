const db = require('../config/db');

function normalizeNumber(n) {
  if (!n) return n;
  const stripped = n.replace(/\s+/g, '');
  return stripped.startsWith('whatsapp:') ? stripped : `whatsapp:${stripped}`;
}

async function list() {
  const { rows } = await db.query(
    `SELECT * FROM bots ORDER BY created_at ASC`
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(`SELECT * FROM bots WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function getBySlug(slug) {
  const { rows } = await db.query(
    `SELECT * FROM bots WHERE slug = $1`,
    [String(slug || '').toLowerCase()]
  );
  return rows[0] || null;
}

async function getByTwilioNumber(twilioNumber) {
  const { rows } = await db.query(
    `SELECT * FROM bots WHERE twilio_number = $1 AND active = TRUE`,
    [normalizeNumber(twilioNumber)]
  );
  return rows[0] || null;
}

async function create(input) {
  const {
    name, slug, twilio_number,
    provider = 'openai', model = 'gpt-4o', temperature = 0.7,
    system_prompt = '', language = 'it',
    transfer_keywords = [], rag_enabled = true, ai_enabled = true, active = true,
    ai_api_key_encrypted = null,
  } = input;

  const { rows } = await db.query(
    `INSERT INTO bots
     (name, slug, twilio_number, provider, model, temperature,
      system_prompt, language, transfer_keywords, rag_enabled, ai_enabled, active, ai_api_key_encrypted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [name, slug, normalizeNumber(twilio_number), provider, model, temperature,
     system_prompt, language, transfer_keywords, rag_enabled, ai_enabled, active, ai_api_key_encrypted]
  );
  return rows[0];
}

const UPDATABLE = [
  'name','slug','twilio_number','provider','model','temperature',
  'system_prompt','language','transfer_keywords','rag_enabled','ai_enabled','active','ai_api_key_encrypted',
];

async function update(id, patch) {
  const fields = [];
  const values = [];
  let i = 1;
  for (const k of UPDATABLE) {
    if (k in patch) {
      fields.push(`${k} = $${i++}`);
      values.push(k === 'twilio_number' ? normalizeNumber(patch[k]) : patch[k]);
    }
  }
  if (fields.length === 0) return getById(id);
  values.push(id);
  const { rows } = await db.query(
    `UPDATE bots SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function remove(id) {
  await db.query(`DELETE FROM bots WHERE id = $1`, [id]);
}

module.exports = {
  normalizeNumber,
  list,
  getById,
  getBySlug,
  getByTwilioNumber,
  create,
  update,
  remove,
};
