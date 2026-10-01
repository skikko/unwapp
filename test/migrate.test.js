const test = require('node:test');
const assert = require('node:assert/strict');
const migrationService = require('../scripts/migrate');

test('calcola checksum stabili per le migrazioni', () => {
  assert.equal(migrationService.checksum('SELECT 1;'), migrationService.checksum('SELECT 1;'));
  assert.notEqual(migrationService.checksum('SELECT 1;'), migrationService.checksum('SELECT 2;'));
});

test('ordina le migrazioni e include le migrazioni CRM', () => {
  const files = migrationService.migrationFiles();
  assert.equal(files.at(-1).filename, '017_email_tracking.sql');
  assert.ok(files.some((file) => file.filename === '010_crm_operations.sql'));
  assert.deepEqual(files.map((file) => file.filename), files.map((file) => file.filename).sort());
});

test('blocca una migrazione già applicata con checksum differente', () => {
  const files = [{ filename: '001_test.sql', checksum: 'current' }];
  const ledger = new Map([['001_test.sql', { checksum: 'previous' }]]);
  assert.throws(() => migrationService.verifyChecksums(files, ledger), /Checksum/);
});

test('normalizza le transazioni legacy prima dell’esecuzione atomica', () => {
  assert.equal(
    migrationService.migrationSql('BEGIN;\nSELECT 1;\nCOMMIT;\n'),
    'SELECT 1;'
  );
  assert.equal(migrationService.migrationSql('SELECT 1;\n'), 'SELECT 1;\n');
});
