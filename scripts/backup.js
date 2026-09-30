const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ quiet: true });

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function connectionEnvironment(connectionString) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the postgres protocol');
  }
  if (!url.hostname || !url.pathname.slice(1)) {
    throw new Error('DATABASE_URL is incomplete');
  }

  const environment = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
  const sslMode = url.searchParams.get('sslmode');
  if (sslMode) environment.PGSSLMODE = sslMode;
  return { environment, host: url.hostname, database: environment.PGDATABASE };
}

function checksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  const connection = connectionEnvironment(process.env.DATABASE_URL);
  const backupDirectory = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups'));
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDirectory, `database-${timestamp}.dump`);
  const previousUmask = process.umask(0o077);
  try {
    console.log(`Backup source: ${connection.host}/${connection.database}`);
    await run('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--file', backupPath,
    ], { env: connection.environment });
  } finally {
    process.umask(previousUmask);
  }

  const stats = fs.statSync(backupPath);
  if (stats.size === 0) throw new Error('pg_dump created an empty backup');
  await run('pg_restore', ['--list', backupPath], { stdio: 'ignore' });

  const digest = await checksum(backupPath);
  fs.writeFileSync(`${backupPath}.sha256`, `${digest}  ${path.basename(backupPath)}\n`, { mode: 0o600 });
  console.log(`OK Backup verified: ${backupPath}`);
  console.log(`OK SHA-256: ${digest}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR Database backup failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { connectionEnvironment };
