const test = require('node:test');
const assert = require('node:assert/strict');
const crmService = require('../src/services/crmService');
const crmRepo = require('../src/repos/crmRepo');
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

test('aggiunge footer e link unsubscribe firmato alle email CRM', () => {
  const previousSecret = process.env.CRM_UNSUBSCRIBE_SECRET;
  process.env.CRM_UNSUBSCRIBE_SECRET = 'x'.repeat(32);
  try {
    const contact = {
      contact_id: '123e4567-e89b-42d3-a456-426614174000',
      email_normalized: 'mario@example.com',
    };
    const html = emailService.appendComplianceFooter('<p>Ciao</p>', contact, 'https://crm.example.com');
    assert.match(html, /P\.IVA: 13513131006/);
    assert.match(html, /\/unsubscribe\?cid=123e4567-e89b-42d3-a456-426614174000&amp;email=mario%40example\.com&amp;sig=/);
    const text = emailService.appendComplianceFooterText('Ciao', contact, 'https://crm.example.com');
    assert.match(text, /Disiscriviti: https:\/\/crm\.example\.com\/unsubscribe/);
  } finally {
    if (previousSecret === undefined) delete process.env.CRM_UNSUBSCRIBE_SECRET;
    else process.env.CRM_UNSUBSCRIBE_SECRET = previousSecret;
  }
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

test('mantiene gli stili sicuri necessari ai blocchi email', () => {
  const html = crmService.sanitizeEmailHtml('<table style="width:100%;margin:0 auto"><tr><td style="padding:20px 12px;border-top:1px solid #d6d6d6;font-family:Arial, sans-serif;line-height:1.6"><a href="https://example.com" style="display:inline-block;border-radius:3px">Apri</a></td></tr></table>');
  assert.match(html, /margin:0 auto/);
  assert.match(html, /padding:20px 12px/);
  assert.match(html, /border-top:1px solid #d6d6d6/);
  assert.match(html, /font-family:Arial, sans-serif/);
  assert.match(html, /line-height:1.6/);
  assert.match(html, /border-radius:3px/);
});

test('incorpora nelle email le immagini archiviate nel CRM', async () => {
  const mediaService = require('../src/services/mediaService');
  const originalGetAsset = mediaService.getAsset;
  mediaService.getAsset = async () => ({
    filename: 'banner.jpg',
    content_type: 'image/jpeg',
    data: Buffer.from('image'),
  });
  try {
    const token = 'A'.repeat(43);
    const result = await emailService.inlineStoredMedia(`<img src="http://127.0.0.1:4187/media/${token}/banner.jpg">`);
    assert.match(result.html, /src="cid:crm-/);
    assert.equal(result.attachments.length, 1);
    assert.equal(result.attachments[0].filename, 'banner.jpg');
    assert.equal(result.attachments[0].contentType, 'image/jpeg');
  } finally {
    mediaService.getAsset = originalGetAsset;
  }
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

test('normalizza condizioni concatenate del trigger di sequenza', () => {
  const sequence = crmService.validateSequence({
    name: 'Genitori webinar',
    trigger: {
      type: 'list_joined',
      listId: 'list-1',
      conditions: [
        { field: 'contactType', operator: 'equals', value: 'Genitore' },
        { field: 'utmCampaign', operator: 'contains', value: 'open-day' },
        { field: 'webinarRegisteredAt', operator: 'is_set' },
      ],
    },
    steps: [{ templateId: 'template-1' }],
  });
  assert.deepEqual(sequence.triggerConditions, [
    { field: 'contactType', operator: 'equals', value: 'parent' },
    { field: 'utmCampaign', operator: 'contains', value: 'open-day' },
    { field: 'webinarRegisteredAt', operator: 'is_set', value: null },
  ]);
});

test('rifiuta campi e operatori non previsti nelle condizioni di sequenza', () => {
  assert.throws(() => crmService.validateSequence({
    name: 'Sequenza non valida',
    trigger: {
      type: 'list_joined',
      listId: 'list-1',
      conditions: [{ field: 'sql', operator: 'equals', value: 'TRUE' }],
    },
    steps: [{ templateId: 'template-1' }],
  }), /Invalid sequence trigger condition/);
});

test('compila le condizioni di sequenza con parametri SQL tipizzati', () => {
  const result = crmRepo.compileSequenceConditions([
    { field: 'contactType', operator: 'equals', value: 'parent' },
    { field: 'contactStatusId', operator: 'not_equals', value: '123e4567-e89b-12d3-a456-426614174000' },
    { field: 'webinarRegisteredAt', operator: 'after', value: '2026-09-30' },
    { field: 'tags', operator: 'contains', value: 'webinar' },
  ], 3);
  assert.match(result.clause, /c\.contact_type = \$3/);
  assert.match(result.clause, /c\.contact_status_id IS DISTINCT FROM \$4::uuid/);
  assert.match(result.clause, /c\.webinar_registered_at > \$5::date/);
  assert.match(result.clause, /\$6 = ANY\(c\.tags\)/);
  assert.deepEqual(result.values, [
    'parent',
    '123e4567-e89b-12d3-a456-426614174000',
    '2026-09-30',
    'webinar',
  ]);
});

test('una lista include soltanto i contatti aggiunti esplicitamente', () => {
  const result = crmRepo.compileListFilter({
    id: '123e4567-e89b-12d3-a456-426614174000',
    filter_json: { hasEmail: true },
  }, 3);
  assert.match(result.clause, /crm_list_memberships/);
  assert.match(result.clause, /lm\.list_id = \$3/);
  assert.doesNotMatch(result.clause, /crm_list_exclusions|email_normalized|TRUE/);
  assert.deepEqual(result.values, ['123e4567-e89b-12d3-a456-426614174000']);
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
  assert.equal(result.mapping.phone, '');
});

test('riconosce le intestazioni telefoniche abbreviate', () => {
  const parsed = csvService.parseCsv('Email,Tel.,Nome\nanna@example.com,+393331234567,Anna\n');
  const result = crmImportService.prepareImport(parsed);
  assert.equal(result.mapping.phone, 'Tel.');
  assert.equal(result.contacts[0].phoneNormalized, '+393331234567');
});
