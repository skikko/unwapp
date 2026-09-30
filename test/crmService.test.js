const test = require('node:test');
const assert = require('node:assert/strict');
const crmService = require('../src/services/crmService');
const crmImportService = require('../src/services/crmImportService');
const csvService = require('../src/services/csvService');
const emailService = require('../src/services/emailService');

test('normalizza email, telefono e tag di un contatto', () => {
  const contact = crmService.normalizeContact({
    email: ' Mario.Rossi@Example.com ',
    phone: 'whatsapp:+39 333 123 4567',
    tags: 'Evento, Lead, evento',
  });
  assert.equal(contact.emailNormalized, 'mario.rossi@example.com');
  assert.equal(contact.phoneNormalized, '+393331234567');
  assert.deepEqual(contact.tags, ['evento', 'lead']);
  assert.equal(contact.emailStatus, 'unknown');
});

test('rifiuta un contatto senza email e telefono', () => {
  assert.throws(() => crmService.normalizeContact({ firstName: 'Mario' }), /required/);
});

test('normalizza campi webinar, tipo contatto e parametri UTM', () => {
  const contact = crmService.normalizeContact({
    email: 'studente@example.com',
    contactType: 'Studente',
    webinarRegisteredAt: '15/09/2026',
    utmSource: ' google ',
    utmMedium: 'cpc',
    utmCampaign: 'webinar',
    utmTerm: 'orientamento',
    utmContent: 'annuncio-a',
  });
  assert.equal(contact.contactType, 'student');
  assert.equal(contact.webinarRegisteredAt, '2026-09-15');
  assert.equal(contact.utmSource, 'google');
  assert.equal(contact.utmContent, 'annuncio-a');
});

test('rifiuta una data webinar impossibile', () => {
  assert.throws(() => crmService.normalizeContact({
    email: 'studente@example.com', webinarRegisteredAt: '31/02/2026',
  }), /Invalid webinar registration date/);
});

test('accetta i campi UTM snake case dalle API esterne', () => {
  const contact = crmService.normalizeContact({
    email: 'api@example.com',
    contact_type: 'Genitore',
    webinar_registered_at: '2026-09-30',
    utm_source: 'meta',
    utm_campaign: 'open-day',
  });
  assert.equal(contact.contactType, 'parent');
  assert.equal(contact.webinarRegisteredAt, '2026-09-30');
  assert.equal(contact.utmSource, 'meta');
  assert.equal(contact.utmCampaign, 'open-day');
});

test('rende le variabili del template e protegge il corpo HTML', () => {
  const contact = { first_name: '<Mario>', last_name: 'Rossi', custom_fields: { city: 'Roma' } };
  assert.equal(emailService.renderTemplate('Ciao {{full_name}} da {{city}}', contact), 'Ciao <Mario> Rossi da Roma');
  assert.equal(emailService.renderTemplate('<p>{{first_name}}</p>', contact, { html: true }), '<p>&lt;Mario&gt;</p>');
});

test('applica i valori predefiniti Gmail', () => {
  const result = emailService.validateSettings({
    provider: 'gmail',
    username: 'sender@example.com',
    password: 'app-password',
    fromEmail: 'sender@example.com',
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.merged.host, 'smtp.gmail.com');
  assert.equal(result.merged.port, 465);
  assert.equal(result.merged.secure, true);
});

test('sanitizza il codice HTML del template email', () => {
  const template = crmService.validateTemplate({
    name: 'Newsletter',
    subject: 'Aggiornamento',
    htmlBody: '<p onclick="alert(1)">Ciao</p><script>alert(1)</script><a href="javascript:alert(1)">Apri</a>',
  });
  assert.equal(template.htmlBody.includes('<script'), false);
  assert.equal(template.htmlBody.includes('onclick'), false);
  assert.equal(template.htmlBody.includes('javascript:'), false);
  assert.match(template.htmlBody, /rel="noopener noreferrer"/);
});

test('normalizza stato e ritardi di una sequenza', () => {
  const sequence = crmService.validateSequence({
    name: 'Onboarding',
    active: false,
    trigger: { type: 'list_joined', listId: 'list-1' },
    steps: [{ templateId: 'template-1', delayMinutes: 1440.9 }],
  });
  assert.equal(sequence.active, false);
  assert.equal(sequence.triggerType, 'list_joined');
  assert.equal(sequence.triggerListId, 'list-1');
  assert.deepEqual(sequence.steps, [{ templateId: 'template-1', delayMinutes: 1440 }]);
});

test('richiede una lista per il trigger di ingresso', () => {
  assert.throws(() => crmService.validateSequence({
    name: 'Onboarding',
    trigger: { type: 'list_joined' },
    steps: [{ templateId: 'template-1' }],
  }), /list is required/i);
});

test('normalizza le modifiche massive dei contatti', () => {
  const changes = crmService.normalizeBulkContactChanges({
    emailStatus: 'subscribed', addTags: 'Newsletter, Evento',
    listAction: 'add', listId: 'list-1',
  });
  assert.deepEqual(changes.addTags, ['newsletter', 'evento']);
  assert.equal(changes.emailStatus, 'subscribed');
  assert.equal(changes.listAction, 'add');
});

test('rifiuta una modifica massiva vuota', () => {
  assert.throws(() => crmService.normalizeBulkContactChanges({}), /at least one bulk change/i);
});

test('mappa e prepara i contatti CRM da un CSV', () => {
  const parsed = csvService.parseCsv('Email;Nome;Cognome;Telefono;Tag;Citta\nanna@example.com;Anna;Verdi;+393331234567;Lead|Evento;Roma\n');
  const result = crmImportService.prepareImport(parsed, { tags: 'newsletter', source: 'csv-test' });
  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].emailNormalized, 'anna@example.com');
  assert.equal(result.contacts[0].phoneNormalized, '+393331234567');
  assert.deepEqual(result.contacts[0].tags, ['newsletter', 'lead', 'evento']);
  assert.deepEqual(result.contacts[0].customFields, { Citta: 'Roma' });
  assert.equal(result.contacts[0].emailStatus, 'unknown');
});

test('scarta righe non valide e duplicati nel CSV CRM', () => {
  const parsed = csvService.parseCsv('email,telefono,nome\ninvalid,,Mario\nanna@example.com,+393331234567,Anna\nanna@example.com,+393339999999,Anna bis\n');
  const result = crmImportService.prepareImport(parsed);
  assert.equal(result.contacts.length, 1);
  assert.equal(result.invalid.length, 1);
  assert.equal(result.duplicates.length, 1);
});

test('mappa le colonne del CSV webinar', () => {
  const parsed = csvService.parseCsv('Email,Nome,Cognome,Registrazione,Genitore o Studente,Marketing Consent,utm_source,utm_campaign,utm_content\nanna@example.com,Anna,Verdi,15/09/2026,Genitore,Accepted,meta,webinar,video\n');
  const result = crmImportService.prepareImport(parsed);
  assert.equal(result.contacts[0].contactType, 'parent');
  assert.equal(result.contacts[0].webinarRegisteredAt, '2026-09-15');
  assert.equal(result.contacts[0].emailStatus, 'subscribed');
  assert.equal(result.contacts[0].utmSource, 'meta');
  assert.equal(result.contacts[0].utmCampaign, 'webinar');
  assert.equal(result.contacts[0].utmContent, 'video');
});
