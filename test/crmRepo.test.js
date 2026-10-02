const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const crmRepo = require('../src/repos/crmRepo');

test('duplica un template mantenendo contenuto e allegati', async (t) => {
  const originalQuery = db.query;
  let queryCall;
  db.query = async (sql, values) => {
    queryCall = { sql, values };
    return { rows: [{ id: 'copy-1', name: 'Newsletter - copia' }] };
  };
  t.after(() => { db.query = originalQuery; });

  const copy = await crmRepo.duplicateTemplate('template-1', 'admin');

  assert.equal(copy.id, 'copy-1');
  assert.match(queryCall.sql, /name \|\| ' - copia'/);
  assert.match(queryCall.sql, /attachments/);
  assert.match(queryCall.sql, /folder_id/);
  assert.deepEqual(queryCall.values, ['template-1', 'admin']);
});

test('duplica una sequenza disattivata senza copiare le iscrizioni', async (t) => {
  const originalGetClient = db.getClient;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT * FROM crm_sequences')) return { rows: [{ id: 'sequence-1' }] };
      if (sql.includes('INSERT INTO crm_sequences')) {
        return { rows: [{ id: 'sequence-copy', trigger_list_id: 'list-1', active: false }] };
      }
      if (sql.startsWith('SELECT * FROM crm_lists')) return { rows: [{ id: 'list-1' }] };
      return { rows: [] };
    },
    release() {},
  };
  db.getClient = async () => client;
  t.after(() => { db.getClient = originalGetClient; });

  const copy = await crmRepo.duplicateSequence('sequence-1', 'admin');

  assert.equal(copy.id, 'sequence-copy');
  const sequenceInsert = calls.find((call) => call.sql.includes('INSERT INTO crm_sequences'));
  const stepsInsert = calls.find((call) => call.sql.includes('INSERT INTO crm_sequence_steps'));
  assert.match(sequenceInsert.sql, /description,FALSE,trigger_type/);
  assert.match(sequenceInsert.sql, /folder_id/);
  assert.deepEqual(sequenceInsert.values, ['sequence-1', 'admin']);
  assert.deepEqual(stepsInsert.values, ['sequence-1', 'sequence-copy']);
  assert.equal(calls.some((call) => call.sql.includes('crm_sequence_enrollments')), false);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('crea e rinomina cartelle contenuto mantenendo il tipo', async (t) => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ id: 'folder-1', kind: values[0] === 'folder-1' ? values[3] : values[0], name: values[1] }] };
  };
  t.after(() => { db.query = originalQuery; });

  await crmRepo.createContentFolder({ kind: 'template', name: 'Webinar', description: 'Template webinar', createdBy: 'admin' });
  await crmRepo.updateContentFolder('folder-1', { kind: 'template', name: 'Webinar 2026', description: '' });

  assert.deepEqual(calls[0].values, ['template', 'Webinar', 'Template webinar', 'admin']);
  assert.deepEqual(calls[1].values, ['folder-1', 'Webinar 2026', null, 'template']);
  assert.match(calls[1].sql, /WHERE id=\$1 AND kind=\$4/);
});
