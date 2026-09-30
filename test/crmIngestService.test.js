const test = require('node:test');
const assert = require('node:assert/strict');
const crmIngestService = require('../src/services/crmIngestService');

test('canonicalizza il payload indipendentemente dall’ordine delle proprietà', () => {
  const first = crmIngestService.canonicalJson({ source: 'wordpress', contact: { email: 'a@example.com', name: 'A' } });
  const second = crmIngestService.canonicalJson({ contact: { name: 'A', email: 'a@example.com' }, source: 'wordpress' });
  assert.equal(first, second);
});

test('adatta il payload nativo di Fluent Forms', () => {
  const contact = crmIngestService.adaptExternalContact({
    nome_cognome: { first_name: 'Mario', last_name: 'Rossi' },
    email: 'mario@example.com',
    genitore_studente: 'Studente',
    data_scelta: '01/10/2026',
    privacy_cookie_consent: 'on',
    marketing_consent: 'on',
    utm_source: 'muner',
  }, new Date('2026-09-30T10:00:00.000Z'));
  assert.equal(contact.firstName, 'Mario');
  assert.equal(contact.lastName, 'Rossi');
  assert.equal(contact.contactType, 'Studente');
  assert.equal(contact.webinarRegisteredAt, '01/10/2026');
  assert.equal(contact.emailStatus, 'subscribed');
  assert.equal(contact.consentAt, '2026-09-30T10:00:00.000Z');
  assert.equal(contact.consentSource, 'fluent-forms');
  assert.deepEqual(contact.consentProof, { privacyConsent: true, marketingConsent: true });
});

test('esclude dalle campagne il contatto Fluent Forms senza consenso marketing', () => {
  const contact = crmIngestService.adaptExternalContact({
    nome_cognome: { first_name: 'Anna', last_name: 'Verdi' },
    email: 'anna@example.com',
    privacy_cookie_consent: 'on',
  });
  assert.equal(contact.emailStatus, 'unsubscribed');
  assert.equal(contact.consentAt, null);
  assert.equal(contact.consentSource, null);
  assert.deepEqual(contact.consentProof, { privacyConsent: true, marketingConsent: false });
});
