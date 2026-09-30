require('dotenv').config({ quiet: true });
const mediaRepo = require('../src/repos/mediaRepo');
const objectStorageService = require('../src/services/objectStorageService');
const db = require('../src/config/db');

async function migrateMedia() {
  if (!objectStorageService.isConfigured()) throw new Error('Object storage is not configured');
  let migrated = 0;
  while (true) {
    const assets = await mediaRepo.listDatabaseAssets({ limit: 100 });
    if (!assets.length) break;
    for (const asset of assets) {
      const key = objectStorageService.objectKey(asset.id, asset.filename);
      await objectStorageService.put(key, asset.data, asset.content_type);
      const stored = await mediaRepo.markStored(asset.id, key);
      if (!stored) await objectStorageService.remove(key).catch(() => {});
      else migrated += 1;
    }
    console.log(`OK ${migrated} media assets migrated`);
  }
  return migrated;
}

if (require.main === module) {
  migrateMedia()
    .then(async (migrated) => {
      console.log(`OK Media migration completed: ${migrated}`);
      await db.pool.end();
    })
    .catch(async (error) => {
      console.error('ERROR Media migration failed:', error.message);
      await db.pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { migrateMedia };
