const db = require('../config/db');

async function create(input) {
  const { rows } = await db.query(
    `INSERT INTO media_assets
     (token_hash, filename, content_type, byte_size, data, storage_provider, storage_key, uploaded_by, purpose)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, filename, content_type, byte_size, storage_provider, storage_key, purpose, created_at`,
    [input.tokenHash, input.filename, input.contentType, input.byteSize,
      input.data || null, input.storageProvider || 'database', input.storageKey || null,
      input.uploadedBy || null, input.purpose || 'chat']
  );
  return rows[0];
}

async function getByTokenHash(tokenHash) {
  const { rows } = await db.query(
    `SELECT id, filename, content_type, byte_size, data, storage_provider, storage_key, purpose, created_at
     FROM media_assets WHERE token_hash = $1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function listDatabaseAssets({ limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT id,filename,content_type,data FROM media_assets
     WHERE storage_provider='database' AND data IS NOT NULL
     ORDER BY created_at ASC LIMIT $1`,
    [limit]
  );
  return rows;
}

async function markStored(id, storageKey) {
  const { rowCount } = await db.query(
    `UPDATE media_assets SET storage_provider='s3',storage_key=$2,data=NULL
     WHERE id=$1 AND storage_provider='database'`,
    [id, storageKey]
  );
  return rowCount === 1;
}

module.exports = { create, getByTokenHash, listDatabaseAssets, markStored };
