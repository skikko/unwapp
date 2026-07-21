const test = require('node:test');
const assert = require('node:assert/strict');
const authService = require('../src/services/authService');

test('i ruoli espongono solo i permessi previsti', () => {
  assert.equal(authService.can({ permissions: ['*'] }, 'admin'), true);
  assert.equal(authService.can({ permissions: authService.ROLES.operator }, 'chat:write'), true);
  assert.equal(authService.can({ permissions: authService.ROLES.operator }, 'broadcast:write'), false);
  assert.equal(authService.can({ permissions: authService.ROLES.broadcaster }, 'broadcast:write'), true);
  assert.equal(authService.can({ permissions: authService.ROLES.viewer }, 'chat:write'), false);
});

test('il cookie di sessione è HttpOnly e viene letto correttamente', () => {
  const header = authService.sessionCookie('secret-token', { secure: true });
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Secure/);
  assert.equal(authService.readSessionCookie(`other=x; ${header}`), 'secret-token');
});

test('la cancellazione del cookie azzera la durata', () => {
  assert.match(authService.sessionCookie('', { clear: true }), /Max-Age=0/);
});
