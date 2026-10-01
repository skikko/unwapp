require('dotenv').config({ quiet: true });

const db = require('../src/config/db');
const encryptionKeyGuard = require('../src/services/encryptionKeyGuard');
const { migrate } = require('./migrate');

async function main() {
  const encryptionStatus = await encryptionKeyGuard.verifyEncryptionKey();
  console.log(`OK APP_ENCRYPTION_KEY ${encryptionStatus}`);

  await migrate();
  await migrate({ checkOnly: true });
}

main()
  .catch((error) => {
    console.error(`ERROR Pre-deploy failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
