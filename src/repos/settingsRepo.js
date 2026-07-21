const db = require('../config/db');

async function getMany(keys) {
  const { rows } = await db.query(
    `SELECT key, value_encrypted, updated_at
     FROM app_settings WHERE key = ANY($1::text[])`,
    [keys]
  );
  return Object.fromEntries(rows.map((row) => [row.key, row]));
}

async function setMany(values, updatedBy) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (const [key, valueEncrypted] of Object.entries(values)) {
      await client.query(
        `INSERT INTO app_settings (key, value_encrypted, updated_by, updated_at)
         VALUES ($1,$2,$3,now())
         ON CONFLICT (key) DO UPDATE SET
           value_encrypted = EXCLUDED.value_encrypted,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [key, valueEncrypted, updatedBy]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { getMany, setMany };
