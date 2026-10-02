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
  assert.deepEqual(sequenceInsert.values, ['sequence-1', 'admin']);
  assert.deepEqual(stepsInsert.values, ['sequence-1', 'sequence-copy']);
  assert.equal(calls.some((call) => call.sql.includes('crm_sequence_enrollments')), false);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});
