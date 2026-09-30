const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ quiet: true });

const root = path.resolve(__dirname, '..');
const migrationsDirectory = path.join(root, 'migrations');
const migrationLockName = 'un_whatsapp_manager_migrations';

function checksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function migrationFiles() {
  return fs.readdirSync(migrationsDirectory)
    .filter((filename) => /^\d+.*\.sql$/.test(filename))
    .sort()
    .map((filename) => {
      const content = fs.readFileSync(path.join(migrationsDirectory, filename), 'utf8');
      return { filename, content, checksum: checksum(content) };
    });
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function readLedger(client) {
  const { rows } = await client.query(
    'SELECT filename, checksum, applied_at FROM schema_migrations ORDER BY filename ASC'
  );
  return new Map(rows.map((row) => [row.filename, row]));
}

function verifyChecksums(files, ledger) {
  for (const file of files) {
    const applied = ledger.get(file.filename);
    if (applied && applied.checksum !== file.checksum) {
      throw new Error(`Checksum mismatch for applied migration: ${file.filename}`);
    }
  }
}

async function recordMigration(client, file) {
  await client.query(
    `INSERT INTO schema_migrations (filename, checksum)
     VALUES ($1, $2)
     ON CONFLICT (filename) DO NOTHING`,
    [file.filename, file.checksum]
  );
}

function migrationSql(content) {
  return content
    .replace(/^\s*BEGIN;\s*/i, '')
    .replace(/\s*COMMIT;\s*$/i, '');
}

async function bootstrapEmptyDatabase(client, files) {
  const { rows: [state] } = await client.query(
    `SELECT to_regclass('public.bots') IS NOT NULL AS initialized`
  );
  if (state.initialized) return false;

  await client.query('BEGIN');
  try {
    await client.query(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
    for (const file of files) await recordMigration(client, file);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  console.log(`OK Database initialized; ${files.length} migrations registered as baseline`);
  return true;
}

async function migrationStatus(client, files) {
  const ledger = await readLedger(client);
  verifyChecksums(files, ledger);
  return {
    applied: files.filter((file) => ledger.has(file.filename)),
    pending: files.filter((file) => !ledger.has(file.filename)),
  };
}

async function runMigrations(client, files) {
  const status = await migrationStatus(client, files);
  for (const file of status.pending) {
    await client.query('BEGIN');
    try {
      await client.query(migrationSql(file.content));
      await recordMigration(client, file);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log(`OK Migration ${file.filename} applied (${file.checksum.slice(0, 12)})`);
  }
  return migrationStatus(client, files);
}

async function migrate({ checkOnly = false } = {}) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const files = migrationFiles();
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [migrationLockName]);
    await ensureLedger(client);

    if (checkOnly) {
      const status = await migrationStatus(client, files);
      if (status.pending.length) {
        throw new Error(`Pending migrations: ${status.pending.map((file) => file.filename).join(', ')}`);
      }
      console.log(`OK ${status.applied.length} migrations verified`);
      return status;
    }

    const bootstrapped = await bootstrapEmptyDatabase(client, files);
    const status = bootstrapped ? await migrationStatus(client, files) : await runMigrations(client, files);
    console.log(`OK Migrations complete: ${status.applied.length} applied, ${status.pending.length} pending`);
    return status;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [migrationLockName]);
    } finally {
      await client.end();
    }
  }
}

if (require.main === module) {
  migrate({ checkOnly: process.argv.includes('--check') }).catch((error) => {
    console.error('ERROR Database migration failed:', error.message);
    process.exit(1);
  });
}

module.exports = {
  checksum,
  migrationSql,
  migrationFiles,
  verifyChecksums,
  migrate,
};
