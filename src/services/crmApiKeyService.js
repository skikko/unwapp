const crypto = require('crypto');
const crmApiKeyRepo = require('../repos/crmApiKeyRepo');

const ALLOWED_SCOPES = new Set(['contacts:write', 'whatsapp:send']);

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateSecret() {
  return `crm_live_${crypto.randomBytes(32).toString('base64url')}`;
}

function normalizeInput(input = {}) {
  const name = String(input.name || '').trim().slice(0, 120);
  const source = String(input.source || '').trim().toLowerCase().slice(0, 80);
  const scopes = [...new Set((Array.isArray(input.scopes) ? input.scopes : ['contacts:write'])
    .map(String).filter((scope) => ALLOWED_SCOPES.has(scope)))];
  if (!name || !source || !scopes.length) {
    throw Object.assign(new Error('Name, source, and at least one valid scope are required'), { status: 400 });
  }
  let expiresAt = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime()) || parsed <= new Date()) {
      throw Object.assign(new Error('API key expiration is invalid'), { status: 400 });
    }
    expiresAt = parsed.toISOString();
  }
  return { name, source, scopes, expiresAt };
}

async function create(input, createdBy) {
  const normalized = normalizeInput(input);
  const secret = generateSecret();
  const key = await crmApiKeyRepo.create({
    ...normalized,
    keyPrefix: secret.slice(0, 16),
    keyHash: hashKey(secret),
    createdBy,
  });
  return { key, secret };
}

async function rotate(id) {
  const secret = generateSecret();
  const key = await crmApiKeyRepo.rotate(id, {
    keyPrefix: secret.slice(0, 16),
    keyHash: hashKey(secret),
  });
  if (!key) throw Object.assign(new Error('API key not found'), { status: 404 });
  return { key, secret };
}

module.exports = { ALLOWED_SCOPES, hashKey, create, rotate };
