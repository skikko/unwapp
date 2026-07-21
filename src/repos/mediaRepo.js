const db = require('../config/db');

async function create(input) {
  const { rows } = await db.query(
    `INSERT INTO media_assets
     (token_hash, filename, content_type, byte_size, data, uploaded_by, purpose)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, filename, content_type, byte_size, purpose, created_at`,
    [input.tokenHash, input.filename, input.contentType, input.byteSize,
      input.data, input.uploadedBy || null, input.purpose || 'chat']
  );
  return rows[0];
}

async function getByTokenHash(tokenHash) {
  const { rows } = await db.query(
    `SELECT id, filename, content_type, byte_size, data, purpose, created_at
     FROM media_assets WHERE token_hash = $1`,
    [tokenHash]
  );
  return rows[0] || null;
}

module.exports = { create, getByTokenHash };
