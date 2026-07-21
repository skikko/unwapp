const authService = require('../services/authService');

function devUser() {
  if (!process.env.DEV_ADMIN_EMAIL) return null;
  return {
    id: 'development', username: process.env.DEV_ADMIN_EMAIL,
    displayName: 'Development admin', role: 'admin', permissions: ['*'],
  };
}

async function authenticate(req) {
  if (req.user) return req.user;
  const development = devUser();
  if (development) { req.user = development; return development; }
  const token = authService.readSessionCookie(req.headers.cookie || '');
  if (!token) return null;
  const user = await authService.userFromSession(token);
  if (user) req.user = user;
  return user;
}

function requireAuth(req, res, next) {
  authenticate(req).then((user) => {
    if (!user) return res.status(401).json({ error: 'Autenticazione richiesta' });
    next();
  }).catch(next);
}

function requirePermission(permission) {
  return (req, res, next) => {
    authenticate(req).then((user) => {
      if (!user) return res.status(401).json({ error: 'Autenticazione richiesta' });
      if (!authService.can(user, permission)) return res.status(403).json({ error: 'Permesso insufficiente' });
      next();
    }).catch(next);
  };
}

function requirePage(permission) {
  return (req, res, next) => {
    authenticate(req).then((user) => {
      if (!user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      if (permission && !authService.can(user, permission)) return res.status(403).send('Accesso non autorizzato');
      next();
    }).catch(next);
  };
}

module.exports = { authenticate, requireAuth, requireAdmin: requirePermission('admin'), requirePermission, requirePage };
