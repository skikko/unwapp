const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const authRepo = require('../repos/authRepo');

const COOKIE_NAME = 'un_session';
const SESSION_HOURS = Math.max(1, Number(process.env.SESSION_HOURS || 12));
const ROLES = {
  admin: ['*'],
  operator: ['bots:read', 'chat:read', 'chat:write'],
  broadcaster: ['bots:read', 'broadcast:read', 'broadcast:write'],
  viewer: ['bots:read', 'chat:read', 'broadcast:read'],
};

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validatePassword(password) {
  if (String(password || '').length < 10) throw Object.assign(new Error('La password deve contenere almeno 10 caratteri'), { status: 400 });
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
    permissions: ROLES[row.role] || [],
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

function can(user, permission) {
  return Boolean(user && (user.permissions?.includes('*') || user.permissions?.includes(permission) || permission === 'authenticated'));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readSessionCookie(header) {
  const item = String(header).split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return item ? decodeURIComponent(item.slice(COOKIE_NAME.length + 1)) : null;
}

function sessionCookie(token, { secure = false, clear = false } = {}) {
  const parts = [`${COOKIE_NAME}=${clear ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${SESSION_HOURS * 3600}`);
  return parts.join('; ');
}

async function login(username, password) {
  const user = await authRepo.findByUsername(normalizeUsername(username));
  if (!user || !user.active || !await bcrypt.compare(String(password || ''), user.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await authRepo.createSession(hashToken(token), user.id, expiresAt);
  await authRepo.markLogin(user.id);
  return { token, user: publicUser(user) };
}

async function logout(token) {
  if (token) await authRepo.deleteSession(hashToken(token));
}

async function userFromSession(token) {
  const tokenHash = hashToken(token);
  const row = await authRepo.getSession(tokenHash);
  if (!row) return null;
  authRepo.touchSession(tokenHash).catch(() => {});
  return publicUser(row);
}

async function createUser(input) {
  const username = normalizeUsername(input.username);
  if (!/^[a-z0-9._@-]{3,80}$/.test(username)) throw Object.assign(new Error('Nome utente non valido'), { status: 400 });
  if (!ROLES[input.role]) throw Object.assign(new Error('Ruolo non valido'), { status: 400 });
  validatePassword(input.password);
  return publicUser(await authRepo.createUser({
    username, displayName: String(input.displayName || username).trim(),
    passwordHash: await bcrypt.hash(input.password, 12), role: input.role,
  }));
}

async function updateUser(id, input, actorId) {
  const existing = await authRepo.getById(id);
  if (!existing) throw Object.assign(new Error('Account non trovato'), { status: 404 });
  if (input.role && !ROLES[input.role]) throw Object.assign(new Error('Ruolo non valido'), { status: 400 });
  if (existing.role === 'admin' && (input.role && input.role !== 'admin' || input.active === false)) {
    if (await authRepo.countActiveAdmins() <= 1) throw Object.assign(new Error('Deve rimanere almeno un amministratore attivo'), { status: 409 });
  }
  const patch = {};
  const roleChanged = Boolean(input.role && input.role !== existing.role);
  if (Object.hasOwn(input, 'displayName')) patch.display_name = String(input.displayName).trim();
  if (Object.hasOwn(input, 'role')) patch.role = input.role;
  if (Object.hasOwn(input, 'active')) patch.active = Boolean(input.active);
  if (input.password) { validatePassword(input.password); patch.password_hash = await bcrypt.hash(input.password, 12); }
  const updated = await authRepo.updateUser(id, patch);
  if (input.password || input.active === false || roleChanged) await authRepo.deleteUserSessions(id);
  return publicUser(updated);
}

async function removeUser(id, actorId) {
  if (id === actorId) throw Object.assign(new Error('Non puoi eliminare il tuo account'), { status: 409 });
  const existing = await authRepo.getById(id);
  if (!existing) throw Object.assign(new Error('Account non trovato'), { status: 404 });
  if (existing.role === 'admin' && await authRepo.countActiveAdmins() <= 1) throw Object.assign(new Error('Deve rimanere almeno un amministratore attivo'), { status: 409 });
  return authRepo.removeUser(id);
}

async function ensureBootstrapAdmin() {
  if (await authRepo.countUsers()) return false;
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password) return false;
  await createUser({ username, password, displayName: 'Amministratore', role: 'admin' });
  return true;
}

module.exports = {
  ROLES, can, readSessionCookie, sessionCookie, login, logout, userFromSession,
  publicUser, createUser, updateUser, removeUser, ensureBootstrapAdmin,
};
