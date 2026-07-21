const db = require('../config/db');

async function countUsers() {
  const { rows } = await db.query('SELECT count(*)::int AS count FROM app_users');
  return rows[0].count;
}

async function createUser({ username, displayName, passwordHash, role }) {
  const { rows } = await db.query(
    `INSERT INTO app_users (username, display_name, password_hash, role)
     VALUES ($1,$2,$3,$4) RETURNING id, username, display_name, role, active, created_at`,
    [username, displayName, passwordHash, role]
  );
  return rows[0];
}

async function findByUsername(username) {
  const { rows } = await db.query(
    'SELECT * FROM app_users WHERE username = $1', [String(username || '').toLowerCase()]
  );
  return rows[0] || null;
}

async function getById(id) {
  const { rows } = await db.query('SELECT * FROM app_users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listUsers() {
  const { rows } = await db.query(
    `SELECT id, username, display_name, role, active, last_login_at, created_at
     FROM app_users ORDER BY created_at ASC`
  );
  return rows;
}

async function updateUser(id, patch) {
  const allowed = ['display_name', 'role', 'active', 'password_hash'];
  const fields = [];
  const values = [];
  for (const key of allowed) {
    if (Object.hasOwn(patch, key)) {
      values.push(patch[key]);
      fields.push(`${key} = $${values.length}`);
    }
  }
  if (!fields.length) return getById(id);
  values.push(id);
  const { rows } = await db.query(
    `UPDATE app_users SET ${fields.join(', ')}, updated_at = now()
     WHERE id = $${values.length}
     RETURNING id, username, display_name, role, active, last_login_at, created_at`,
    values
  );
  return rows[0] || null;
}

async function removeUser(id) {
  const { rowCount } = await db.query('DELETE FROM app_users WHERE id = $1', [id]);
  return rowCount > 0;
}

async function countActiveAdmins() {
  const { rows } = await db.query("SELECT count(*)::int AS count FROM app_users WHERE role = 'admin' AND active = TRUE");
  return rows[0].count;
}

async function createSession(tokenHash, userId, expiresAt) {
  await db.query(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`,
    [tokenHash, userId, expiresAt]
  );
}

async function getSession(tokenHash) {
  const { rows } = await db.query(
    `SELECT s.token_hash, s.expires_at, u.*
     FROM auth_sessions s JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = TRUE`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function touchSession(tokenHash) {
  await db.query('UPDATE auth_sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenHash]);
}

async function deleteSession(tokenHash) {
  await db.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
}

async function deleteUserSessions(userId) {
  await db.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
}

async function markLogin(userId) {
  await db.query('UPDATE app_users SET last_login_at = now() WHERE id = $1', [userId]);
}

module.exports = {
  countUsers, createUser, findByUsername, getById, listUsers, updateUser, removeUser,
  countActiveAdmins, createSession, getSession, touchSession, deleteSession,
  deleteUserSessions, markLogin,
};
