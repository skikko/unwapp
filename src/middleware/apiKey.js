const crypto = require('crypto');
const crmApiKeyRepo = require('../repos/crmApiKeyRepo');
const crmApiKeyService = require('../services/crmApiKeyService');

function equal(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerToken(req) {
  const authorization = req.header('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

async function authenticate(req) {
  const token = bearerToken(req);
  if (!token) return null;

  if (token.startsWith('crm_live_')) {
    const key = await crmApiKeyRepo.findByHash(crmApiKeyService.hashKey(token));
    if (!key) return null;
    crmApiKeyRepo.markUsed(key.id).catch(() => {});
    return {
      id: key.id,
      name: key.name,
      source: key.source,
      scopes: key.scopes,
      legacy: false,
    };
  }

  const expected = process.env.OUTBOUND_API_KEY;
  if (expected && equal(token, expected)) {
    return { id: null, name: 'Legacy environment key', source: null, scopes: ['*'], legacy: true };
  }
  return null;
}

function requireApiScope(scope = null, { allowLegacy = true } = {}) {
  return async (req, res, next) => {
    try {
      const apiClient = await authenticate(req);
      if (!apiClient) return res.status(401).json({ error: 'Unauthorized' });
      if (!allowLegacy && apiClient.legacy) {
        return res.status(401).json({ error: 'Managed API key required' });
      }
      if (scope && !apiClient.scopes.includes('*') && !apiClient.scopes.includes(scope)) {
        return res.status(403).json({ error: 'Insufficient API scope' });
      }
      req.apiClient = apiClient;
      next();
    } catch (error) {
      next(error);
    }
  };
}

const requireApiKey = requireApiScope();

module.exports = { requireApiKey, requireApiScope };
