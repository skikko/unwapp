const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePage } = require('../src/middleware/auth');
const { requireApiScope } = require('../src/middleware/apiKey');
const { ROLES } = require('../src/services/authService');

function runPageGuard(permission, role) {
  return new Promise((resolve, reject) => {
    const req = {
      originalUrl: '/protected',
      user: { id: role, role, permissions: ROLES[role] },
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(body) {
        resolve({ statusCode: this.statusCode, body });
      },
      redirect(location) {
        resolve({ statusCode: 302, location });
      },
    };
    requirePage(permission)(req, res, (error) => {
      if (error) reject(error);
      else resolve({ statusCode: 200 });
    });
  });
}

test('WhatsApp User non può aprire le pagine CRM', async () => {
  const result = await runPageGuard('crm:read', 'whatsapp_user');
  assert.equal(result.statusCode, 403);
});

test('CRM User non può aprire le pagine WhatsApp', async () => {
  const result = await runPageGuard('chat:read', 'crm_user');
  assert.equal(result.statusCode, 403);
});

test('admin può aprire entrambe le applicazioni', async () => {
  assert.equal((await runPageGuard('crm:read', 'admin')).statusCode, 200);
  assert.equal((await runPageGuard('chat:read', 'admin')).statusCode, 200);
});

test('l’ingest CRM rifiuta la chiave API legacy', async () => {
  const previous = process.env.OUTBOUND_API_KEY;
  process.env.OUTBOUND_API_KEY = 'legacy-test-key';
  try {
    const result = await new Promise((resolve, reject) => {
      const req = { header: () => 'Bearer legacy-test-key' };
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(body) {
          resolve({ statusCode: this.statusCode, body });
        },
      };
      requireApiScope('contacts:write', { allowLegacy: false })(req, res, (error) => {
        if (error) reject(error);
        else resolve({ statusCode: 200 });
      });
    });
    assert.equal(result.statusCode, 401);
    assert.equal(result.body.error, 'Managed API key required');
  } finally {
    if (previous === undefined) delete process.env.OUTBOUND_API_KEY;
    else process.env.OUTBOUND_API_KEY = previous;
  }
});
