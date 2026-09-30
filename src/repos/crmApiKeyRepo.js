const db = require('../config/db');

async function findByHash(keyHash) {
  const { rows } = await db.query(
    `SELECT * FROM crm_api_keys
     WHERE key_hash=$1 AND active=TRUE AND (expires_at IS NULL OR expires_at > now())`,
    [keyHash]
  );
  return rows[0] || null;
}

async function markUsed(id) {
  await db.query('UPDATE crm_api_keys SET last_used_at=now() WHERE id=$1', [id]);
}

async function list() {
  const { rows } = await db.query(
    `SELECT id,name,source,key_prefix,scopes,active,last_used_at,expires_at,created_by,created_at,revoked_at
     FROM crm_api_keys ORDER BY created_at DESC`
  );
  return rows;
}

async function create(input) {
  const { rows } = await db.query(
    `INSERT INTO crm_api_keys (name,source,key_prefix,key_hash,scopes,expires_at,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id,name,source,key_prefix,scopes,active,last_used_at,expires_at,created_by,created_at,revoked_at`,
    [input.name, input.source, input.keyPrefix, input.keyHash, input.scopes,
      input.expiresAt, input.createdBy]
  );
  return rows[0];
}

async function rotate(id, input) {
  const { rows } = await db.query(
    `UPDATE crm_api_keys
     SET key_prefix=$2,key_hash=$3,active=TRUE,revoked_at=NULL
     WHERE id=$1
     RETURNING id,name,source,key_prefix,scopes,active,last_used_at,expires_at,created_by,created_at,revoked_at`,
    [id, input.keyPrefix, input.keyHash]
  );
  return rows[0] || null;
}

async function revoke(id) {
  const { rows } = await db.query(
    `UPDATE crm_api_keys SET active=FALSE,revoked_at=now()
     WHERE id=$1 RETURNING id`,
    [id]
  );
  return rows[0] || null;
}

module.exports = { findByHash, markUsed, list, create, rotate, revoke };
