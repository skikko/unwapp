const db = require('../config/db');
const secretService = require('./secretService');

const CHECK_KEY = 'system_encryption_key_check';
const CHECK_VALUE = 'APP_ENCRYPTION_KEY_OK_V1';

function decryptCheck(value) {
  try {
    return secretService.decrypt(value) === CHECK_VALUE;
  } catch {
    return false;
  }
}

async function verifyExistingEncryptedValues() {
  const { rows } = await db.query(
    `SELECT 'setting' AS source, key AS identifier, value_encrypted
     FROM app_settings
     WHERE key <> $1
     UNION ALL
     SELECT 'bot' AS source, id::text AS identifier, ai_api_key_encrypted AS value_encrypted
     FROM bots
     WHERE ai_api_key_encrypted IS NOT NULL`,
    [CHECK_KEY]
  );

  for (const row of rows) {
    try {
      secretService.decrypt(row.value_encrypted);
    } catch {
      throw new Error(
        `APP_ENCRYPTION_KEY does not match encrypted data (${row.source}:${row.identifier})`
      );
    }
  }
}

async function verifyEncryptionKey() {
  const existing = await db.query(
    `SELECT value_encrypted
     FROM app_settings
     WHERE key = $1`,
    [CHECK_KEY]
  );

  if (existing.rows[0]) {
    if (!decryptCheck(existing.rows[0].value_encrypted)) {
      throw new Error('APP_ENCRYPTION_KEY does not match the key registered by this database');
    }
    return 'verified';
  }

  await verifyExistingEncryptedValues();
  const encryptedCheck = secretService.encrypt(CHECK_VALUE);
  await db.query(
    `INSERT INTO app_settings (key, value_encrypted, updated_by)
     VALUES ($1, $2, 'system')
     ON CONFLICT (key) DO NOTHING`,
    [CHECK_KEY, encryptedCheck]
  );

  const registered = await db.query(
    `SELECT value_encrypted
     FROM app_settings
     WHERE key = $1`,
    [CHECK_KEY]
  );
  if (!registered.rows[0] || !decryptCheck(registered.rows[0].value_encrypted)) {
    throw new Error('APP_ENCRYPTION_KEY registration failed because another key was registered');
  }
  return 'registered';
}

module.exports = { verifyEncryptionKey };
