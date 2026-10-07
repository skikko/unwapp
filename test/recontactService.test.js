const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const crmRepo = require('../src/repos/crmRepo');
const recontactService = require('../src/services/recontactService');

test('richiede tutti i campi del form di ricontatto', () => {
  assert.throws(() => recontactService.normalizeManualRequest({
    firstName: 'Mario',
    lastName: 'Rossi',
    email: 'mario@example.com',
  }), /obbligatori/);
});

test('normalizza anagrafica e UTM del form di ricontatto', () => {
  const contact = recontactService.normalizeManualRequest({
    nome: ' Mario ',
    cognome: ' Rossi ',
    email: 'MARIO@EXAMPLE.COM',
    telefono: '+39 333 123 4567',
    utm_source: 'meta',
    utm_campaign: 'ricontatto',
  });
  assert.equal(contact.emailNormalized, 'mario@example.com');
  assert.equal(contact.phoneNormalized, '+393331234567');
  assert.equal(contact.utmSource, 'meta');
  assert.equal(contact.utmCampaign, 'ricontatto');
});

test('aggiorna per email e aggiunge alla lista senza cambiare stato email e sorgente', async (t) => {
  const originalGetClient = db.getClient;
  const originalEnsureList = crmRepo.ensureListByNameWithClient;
  const originalAddToList = crmRepo.addContactToListWithClient;
  const calls = [];
  t.after(() => {
    db.getClient = originalGetClient;
    crmRepo.ensureListByNameWithClient = originalEnsureList;
    crmRepo.addContactToListWithClient = originalAddToList;
  });
  db.getClient = async () => ({
    query: async (sql, values = []) => {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT id FROM crm_contacts')) return { rows: [{ id: 'contact-1' }] };
      if (sql.includes('UPDATE crm_contacts SET')) return { rows: [{ id: 'contact-1' }] };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });
  crmRepo.ensureListByNameWithClient = async (_client, name) => ({ id: 'list-1', name });
  crmRepo.addContactToListWithClient = async () => 1;

  const result = await recontactService.registerManualRequest({
    firstName: 'Mario',
    lastName: 'Rossi',
    email: 'mario@example.com',
    phone: '+393331234567',
    utm_source: 'meta',
  });

  const update = calls.find((call) => call.sql.includes('UPDATE crm_contacts SET'));
  assert.equal(result.created, false);
  assert.equal(result.membershipAdded, true);
  assert.match(calls[1].sql, /WHERE email_normalized=\$1/);
  assert.doesNotMatch(update.sql, /email_status=/);
  assert.doesNotMatch(update.sql, /[,\s]source\s*=/);
});

test('crea il contatto quando la email non esiste', async (t) => {
  const originalGetClient = db.getClient;
  const originalEnsureList = crmRepo.ensureListByNameWithClient;
  const originalAddToList = crmRepo.addContactToListWithClient;
  t.after(() => {
    db.getClient = originalGetClient;
    crmRepo.ensureListByNameWithClient = originalEnsureList;
    crmRepo.addContactToListWithClient = originalAddToList;
  });
  db.getClient = async () => ({
    query: async (sql) => {
      if (sql.startsWith('SELECT id FROM crm_contacts')) return { rows: [] };
      if (sql.includes('INSERT INTO crm_contacts')) return { rows: [{ id: 'contact-2' }] };
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });
  crmRepo.ensureListByNameWithClient = async () => ({ id: 'list-1', name: 'Da Ricontattare' });
  crmRepo.addContactToListWithClient = async () => 1;

  const result = await recontactService.registerManualRequest({
    firstName: 'Anna',
    lastName: 'Verdi',
    email: 'anna@example.com',
    phone: '+393331234568',
  });

  assert.equal(result.created, true);
  assert.equal(result.contactId, 'contact-2');
});
