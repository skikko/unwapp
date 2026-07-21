const crypto = require('crypto');

function encryptionKey() {
  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('APP_ENCRYPTION_KEY deve contenere almeno 32 caratteri');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

function decrypt(value) {
  if (!value) throw new Error('API key non configurata per questo BOT');
  const [version, iv, tag, payload] = String(value).split(':');
  if (version !== 'v1' || !iv || !tag || !payload) throw new Error('API key cifrata non valida');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
