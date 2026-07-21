const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ quiet: true });

const root = path.resolve(__dirname, '..');

async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurata');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const legacyTable = ['cour', 'ses'].join('');
    const { rows: [state] } = await client.query(
      `SELECT to_regclass('public.bots') IS NOT NULL AS bots,
              to_regclass($1) IS NOT NULL AS legacy`,
      [`public.${legacyTable}`]
    );

    if (state.bots || state.legacy) {
      const migration = fs.readFileSync(path.join(root, 'migrations', '001_upgrade_to_bots.sql'), 'utf8');
      await client.query(migration);
      console.log('✓ Migrazione database applicata');
    }

    const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('✓ Schema database verificato');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error('Migrazione database non riuscita:', error.message);
    process.exit(1);
  });
}

module.exports = { migrate };
