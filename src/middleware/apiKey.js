// Bearer token auth for server-to-server endpoints (e.g. Salesforce Flow).
// Token is stored in the OUTBOUND_API_KEY environment variable.
//
// Uses a constant-time comparison to avoid timing attacks.
const crypto = require('crypto');

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireApiKey(req, res, next) {
  const expected = process.env.OUTBOUND_API_KEY;
  if (!expected) return res.status(503).json({ error: 'OUTBOUND_API_KEY not configured' });
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!equal(token, expected)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

module.exports = { requireApiKey };
