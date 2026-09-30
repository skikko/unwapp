require('dotenv').config({ quiet: true });

const db = require('../src/config/db');
const encryptionKeyGuard = require('../src/services/encryptionKeyGuard');

async function main() {
  const status = await encryptionKeyGuard.verifyEncryptionKey();
  console.log(`OK APP_ENCRYPTION_KEY ${status}`);
}

main()
  .catch((error) => {
    console.error(`ERROR APP_ENCRYPTION_KEY verification failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });
