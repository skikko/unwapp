const authService = require('../services/authService');
const authRepo = require('../repos/authRepo');

const attempts = new Map();
function allowed(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((time) => now - time < 15 * 60_000);
  attempts.set(ip, recent);
  return recent.length < 5;
}

async function login(req, res) {
  const ip = req.ip || 'unknown';
  if (!allowed(ip)) return res.status(429).json({ error: 'Troppi tentativi. Riprova tra qualche minuto.' });
  const result = await authService.login(req.body?.username, req.body?.password);
  if (!result) {
    attempts.get(ip).push(Date.now());
    return res.status(401).json({ error: 'Nome utente o password non validi' });
  }
  attempts.delete(ip);
  res.setHeader('Set-Cookie', authService.sessionCookie(result.token, { secure: req.secure }));
  res.json({ user: result.user });
}

async function logout(req, res) {
  const token = authService.readSessionCookie(req.headers.cookie || '');
  await authService.logout(token);
  res.setHeader('Set-Cookie', authService.sessionCookie('', { secure: req.secure, clear: true }));
  res.json({ success: true });
}

async function listUsers(_req, res) {
  const users = (await authRepo.listUsers()).map(authService.publicUser);
  res.json({ users, roles: authService.ROLES });
}

async function createUser(req, res) {
  try { res.status(201).json({ user: await authService.createUser(req.body || {}) }); }
  catch (error) { res.status(error.status || (error.code === '23505' ? 409 : 500)).json({ error: error.code === '23505' ? 'Nome utente già esistente' : error.message }); }
}

async function updateUser(req, res) {
  try { res.json({ user: await authService.updateUser(req.params.id, req.body || {}, req.user.id) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
}

async function deleteUser(req, res) {
  try { await authService.removeUser(req.params.id, req.user.id); res.json({ success: true }); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
}

module.exports = { login, logout, listUsers, createUser, updateUser, deleteUser };
