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
  assert.equal(emailService.renderTemplate('{{recontact_url}}', contact, {
    variables: { recontact_url: 'https://crm.example.com/email/recontact' },
  }), 'https://crm.example.com/email/recontact');
});

test('il link Ricontattami apre la thank you page con token senza iscrivere il contatto', async (t) => {
  const previousTrackingSecret = process.env.CRM_TRACKING_SECRET;
  process.env.CRM_TRACKING_SECRET = 'r'.repeat(32);
  const originalRecordEmailEvent = crmRepo.recordEmailEvent;
  crmRepo.recordEmailEvent = async (input) => {
    throw new Error(`Unexpected email event: ${input.eventType}`);
  };
  t.after(() => {
    crmRepo.recordEmailEvent = originalRecordEmailEvent;
    if (previousTrackingSecret === undefined) delete process.env.CRM_TRACKING_SECRET;
    else process.env.CRM_TRACKING_SECRET = previousTrackingSecret;
  });
  const jobId = '123e4567-e89b-42d3-a456-426614174000';
  const redirect = await emailService.requestRecontact({
    jobId,
    sig: emailService.signEmailTracking(jobId, 'recontact'),
  });

  const url = new URL(redirect);
  assert.equal(`${url.origin}${url.pathname}`, 'https://www.unitednetwork.it/grazie-ricontatto/');
  assert.equal(emailService.verifyRecontactToken(url.searchParams.get('token')), jobId);
});

test('il bottone Ricontattami registra la richiesta e iscrive alla lista', async (t) => {
  const previousTrackingSecret = process.env.CRM_TRACKING_SECRET;
  process.env.CRM_TRACKING_SECRET = 'r'.repeat(32);
  const originalRecordEmailEvent = crmRepo.recordEmailEvent;
  const originalGetRecontactContact = crmRepo.getRecontactContact;
  crmRepo.getRecontactContact = async () => ({ email: 'mario@example.com', phone: '+393331234567' });
  let recorded;
  crmRepo.recordEmailEvent = async (input) => {
    recorded = input;
    return { id: input.jobId, membershipAdded: true };
  };
  t.after(() => {
    crmRepo.recordEmailEvent = originalRecordEmailEvent;
    crmRepo.getRecontactContact = originalGetRecontactContact;
    if (previousTrackingSecret === undefined) delete process.env.CRM_TRACKING_SECRET;
    else process.env.CRM_TRACKING_SECRET = previousTrackingSecret;
  });
  const jobId = '123e4567-e89b-42d3-a456-426614174000';
  const result = await emailService.confirmRecontact({
    token: emailService.recontactToken(jobId),
  });

  assert.deepEqual(result, { success: true, membershipAdded: true });
  assert.equal(recorded.jobId, jobId);
  assert.equal(recorded.listName, 'Da Ricontattare');
  assert.equal(recorded.eventType, 'click');
  assert.equal(recorded.url, '/api/public/recontact-request');
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
    assert.match(html, /max-width:640px/);
    assert.match(html, /\/unsubscribe\?cid=123e4567-e89b-42d3-a456-426614174000&amp;email=mario%40example\.com&amp;sig=/);
    const documentHtml = emailService.appendComplianceFooter(
      '<!doctype html><html><head><title>Test</title></head><body><p>Ciao</p></body></html>',
      contact,
      'https://crm.example.com'
    );
    assert.match(documentHtml, /<style>@media[^]*<\/head>/);
    assert.match(documentHtml, /P\.IVA: 13513131006[^]*<\/body><\/html>$/);
    assert.doesNotMatch(documentHtml, /<\/html>[^]+P\.IVA/);
    const text = emailService.appendComplianceFooterText('Ciao', contact, 'https://crm.example.com');
    assert.match(text, /Disiscriviti: https:\/\/crm\.example\.com\/unsubscribe/);
  } finally {
    if (previousSecret === undefined) delete process.env.CRM_UNSUBSCRIBE_SECRET;
    else process.env.CRM_UNSUBSCRIBE_SECRET = previousSecret;
  }
});

test('aggiunge pixel di apertura e tracking click firmato alle email CRM', () => {
  const previousTrackingSecret = process.env.CRM_TRACKING_SECRET;
  process.env.CRM_TRACKING_SECRET = 't'.repeat(32);
  try {
    const job = { id: '123e4567-e89b-42d3-a456-426614174000' };
    const tracked = emailService.applyEmailTracking(
      '<p><a href="https://example.com/page?a=1&b=2">Apri</a><a href="mailto:info@example.com">Email</a><a href="https://crm.example.com/unsubscribe?cid=1">Stop</a><a href="https://crm.example.com/email/recontact?jid=1&sig=2">Richiamami</a></p>',
      job,
      'https://crm.example.com'
    );
    assert.match(tracked, /\/email\/open\.gif\?jid=123e4567-e89b-42d3-a456-426614174000&amp;sig=/);
    assert.match(tracked, /href="https:\/\/crm\.example\.com\/email\/click\?jid=123e4567-e89b-42d3-a456-426614174000&amp;u=/);
    assert.match(tracked, /href="mailto:info@example\.com"/);
    assert.match(tracked, /href="https:\/\/crm\.example\.com\/unsubscribe\?cid=1"/);
    assert.match(tracked, /href="https:\/\/crm\.example\.com\/email\/recontact\?jid=1&sig=2"/);

    const clickHref = tracked.match(/href="([^"]*\/email\/click[^"]*)"/)[1].replaceAll('&amp;', '&');
    const clickUrl = new URL(clickHref);
    const targetUrl = emailService.decodeTrackingUrl(clickUrl.searchParams.get('u'));
    assert.equal(targetUrl, 'https://example.com/page?a=1&b=2');
    assert.equal(emailService.verifyEmailTracking({
      jobId: job.id,
      eventType: 'click',
      url: targetUrl,
      sig: clickUrl.searchParams.get('sig'),
    }), true);
  } finally {
    if (previousTrackingSecret === undefined) delete process.env.CRM_TRACKING_SECRET;
    else process.env.CRM_TRACKING_SECRET = previousTrackingSecret;
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
    attachments: [{
      url: 'https://crm.example.com/media/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/bando.pdf',
      name: 'Bando.pdf',
      type: 'application/pdf',
      size: 1234,
    }],
  });
  assert.equal(template.htmlBody.includes('<script'), false);
  assert.equal(template.htmlBody.includes('onclick'), false);
  assert.equal(template.htmlBody.includes('javascript:'), false);
  assert.match(template.htmlBody, /rel="noopener noreferrer"/);
  assert.deepEqual(template.attachments, [{
    url: 'https://crm.example.com/media/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/bando.pdf',
    name: 'Bando.pdf',
    type: 'application/pdf',
    size: 1234,
  }]);
});

test('normalizza il modello a blocchi del template email', () => {
  const template = crmService.validateTemplate({
    name: 'Newsletter Webinar',
    templateType: 'marketing',
    editorMode: 'visual',
    subject: 'Aggiornamento webinar',
    htmlBody: '<h2>Webinar</h2><p>Ciao {{first_name}}</p>',
    builderModel: {
      schemaVersion: 1,
      globalStyle: {
        backgroundColor: '#F1F5F9',
        contentWidth: 720,
        fontFamily: 'Georgia',
      },
      blocks: [
        { id: 'block-title-1', type: 'heading', html: '<h2 data-builder-id="editor" onclick="alert(1)">Webinar</h2>' },
        { id: 'block-text-1', type: 'text', html: '<p class="email-hide-mobile">Ciao {{first_name}}</p>' },
      ],
    },
    description: 'Template per webinar',
    tags: 'Webinar, Newsletter, webinar',
  });

  assert.equal(template.slug, 'newsletter-webinar');
  assert.equal(template.builderModel.schemaVersion, 2);
  assert.equal(template.builderModel.globalStyle.backgroundColor, '#f1f5f9');
  assert.equal(template.builderModel.globalStyle.contentWidth, 720);
  assert.equal(template.builderModel.globalStyle.fontFamily, 'Georgia');
  assert.equal(template.builderModel.blocks[0].html.includes('data-builder-id'), false);
  assert.equal(template.builderModel.blocks[0].html.includes('onclick'), false);
  assert.match(template.builderModel.blocks[1].html, /class="email-hide-mobile"/);
  assert.deepEqual(template.tags, ['webinar', 'newsletter']);
});

test('genera un documento email deterministico dal modello visuale', () => {
  const model = crmService.normalizeTemplateBuilderModel({
    schemaVersion: 2,
    globalStyle: { contentWidth: 620, paddingX: 32 },
    blocks: [{
      id: 'heading-main',
      type: 'heading',
      style: { align: 'center', paddingTop: 8, hideOnMobile: true },
      html: '<h1 onclick="alert(1)">Ciao {{first_name}}</h1><script>alert(1)</script>',
    }],
  });
  const first = crmService.renderTemplateBuilderHtml(model, { subject: 'Oggetto', preheader: 'Anteprima' });
  const second = crmService.renderTemplateBuilderHtml(model, { subject: 'Oggetto', preheader: 'Anteprima' });

  assert.equal(first, second);
  assert.match(first, /^<!doctype html><html lang="it">/);
  assert.match(first, /<meta name="x-apple-disable-message-reformatting">/);
  assert.match(first, /role="presentation"/);
  assert.match(first, /class="email-block email-block-heading email-hide-mobile"/);
  assert.match(first, /width="620"/);
  assert.match(first, /Anteprima&nbsp;&zwnj;/);
  assert.doesNotMatch(first, /script|onclick|data-builder-/i);
});

test('deriva l’HTML visuale dal modello e pubblica il catalogo variabili', () => {
  const template = crmService.validateTemplate({
    name: 'Template visuale',
    subject: 'Ciao',
    htmlBody: '<script>alert(1)</script>',
    builderModel: {
      blocks: [{ id: 'text-main', type: 'text', html: '<p>Testo</p>' }],
    },
  });

  assert.match(template.htmlBody, /^<!doctype html>/);
  assert.match(template.htmlBody, /<p>Testo<\/p>/);
  assert.doesNotMatch(template.htmlBody, /alert/);
  assert.deepEqual(crmService.templateVariableCatalog().find((variable) => variable.key === 'first_name'), {
    key: 'first_name', group: 'Contatto', label: 'Nome', example: 'Mario', type: 'text',
  });
});

test('sanitizza un documento HTML avanzato mantenendo la struttura email', () => {
  const html = crmService.sanitizeEmailHtml('<!doctype html><html lang="it"><head><meta charset="utf-8"><style>@import url(https://bad.example/x.css);.ok{color:#123456}a{behavior:url(x)}</style><script>alert(1)</script></head><body onload="alert(2)"><p class="ok">Ciao</p></body></html>');

  assert.match(html, /^<!doctype html><html lang="it"><head>/);
  assert.match(html, /\.ok\{color:#123456\}/);
  assert.doesNotMatch(html, /bad\.example|behavior|script|onload/i);
  assert.match(html, /<body><p>Ciao<\/p><\/body><\/html>$/);
});

test('rifiuta identificatori duplicati nel modello a blocchi', () => {
  assert.throws(() => crmService.normalizeTemplateBuilderModel({
    blocks: [
      { id: 'same-block', type: 'text', html: '<p>Uno</p>' },
      { id: 'same-block', type: 'text', html: '<p>Due</p>' },
    ],
  }), /Invalid template builder block/);
});

test('mantiene il token firmato della CTA Ricontattami nel template', () => {
  const template = crmService.validateTemplate({
    name: 'Richiesta ricontatto',
    subject: 'Possiamo aiutarti',
    htmlBody: '<a href="{{recontact_url}}">Ricontattami</a>',
  });
  assert.match(template.htmlBody, /href="{{recontact_url}}"/);
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

test('recupera gli allegati salvati nel template email', async () => {
  const mediaService = require('../src/services/mediaService');
  const originalGetAsset = mediaService.getAsset;
  mediaService.getAsset = async () => ({
    filename: 'bando.pdf',
    content_type: 'application/pdf',
    data: Buffer.from('pdf'),
  });
  try {
    const token = 'B'.repeat(43);
    const result = await emailService.storedTemplateAttachments([
      { url: `https://crm.example.com/media/${token}/bando.pdf`, name: 'bando.pdf' },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].filename, 'bando.pdf');
    assert.equal(result[0].contentType, 'application/pdf');
  } finally {
    mediaService.getAsset = originalGetAsset;
  }
});

test('normalizza stato e ritardi di una sequenza', () => {
  const folderId = '123e4567-e89b-12d3-a456-426614174000';
  const sequence = crmService.validateSequence({
    name: 'Onboarding',
    active: false,
    folderId,
    trigger: { type: 'list_joined', listId: 'list-1' },
    steps: [{ templateId: 'template-1', delayMinutes: 1440.9 }],
  });
  assert.equal(sequence.active, false);
  assert.equal(sequence.triggerType, 'list_joined');
  assert.equal(sequence.triggerListId, 'list-1');
  assert.equal(sequence.folderId, folderId);
  assert.deepEqual(sequence.steps, [{ templateId: 'template-1', delayMinutes: 1440 }]);
});

test('valida la cartella del template', () => {
  const folderId = '123e4567-e89b-12d3-a456-426614174000';
  const template = crmService.validateTemplate({
    name: 'Newsletter',
    subject: 'Aggiornamento',
    htmlBody: '<p>Testo</p>',
    folderId,
  });
  assert.equal(template.folderId, folderId);
  assert.throws(() => crmService.validateTemplate({
    name: 'Newsletter',
    subject: 'Aggiornamento',
    htmlBody: '<p>Testo</p>',
    folderId: 'non-valida',
  }), /Invalid content folder/);
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

test('normalizza una automazione su campo contatto con azioni lista e notifica', () => {
  const automation = crmService.validateAutomation({
    name: 'Lead genitori',
    trigger: {
      type: 'contact_saved',
      condition: { field: 'contactType', operator: 'equals', value: 'Genitore' },
    },
    actions: [
      { type: 'add_to_list', targetListId: '123e4567-e89b-12d3-a456-426614174000' },
      { type: 'notify_email', toEmail: ' Team@Example.com ', subject: 'Nuovo lead', body: 'Controlla il contatto' },
    ],
  });
  assert.equal(automation.triggerType, 'contact_saved');
  assert.deepEqual(automation.triggerCondition, { field: 'contactType', operator: 'equals', value: 'parent' });
  assert.equal(automation.actions[0].targetListId, '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(automation.actions[1].toEmail, 'team@example.com');
});

test('richiede almeno una azione per una automazione', () => {
  assert.throws(() => crmService.validateAutomation({
    name: 'Automazione vuota',
    trigger: {
      type: 'contact_saved',
      condition: { field: 'email', operator: 'is_set' },
    },
    actions: [],
  }), /at least one automation action/i);
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

test('filtra i contatti per tipo studente o genitore', () => {
  const filters = crmService.contactFiltersFromQuery({ contactType: 'Genitore' });
  const result = crmRepo.compileContactFilters(filters, 2);
  assert.match(result.clause, /c\.contact_type = \$2/);
  assert.deepEqual(result.values, ['parent']);
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

test('ordina prima le liste preferite e poi per ultimo ingresso contatto', async (t) => {
  const db = require('../src/config/db');
  const originalQuery = db.query;
  let captured;
  t.after(() => { db.query = originalQuery; });
  db.query = async (text) => {
    captured = text;
    return { rows: [] };
  };

  await crmRepo.listLists();

  assert.match(captured, /max\(lm\.created_at\) AS last_contact_joined_at/);
  assert.match(captured, /ORDER BY l\.is_favorite DESC,max\(lm\.created_at\) DESC NULLS LAST,l\.updated_at DESC/);
});

test('calcola il periodo della dashboard su 7 o 30 giorni', () => {
  const now = new Date('2026-10-09T12:00:00.000Z');

  assert.equal(crmRepo.dashboardPeriodStart('week', now), '2026-10-02T12:00:00.000Z');
  assert.equal(crmRepo.dashboardPeriodStart('month', now), '2026-09-09T12:00:00.000Z');
  assert.equal(crmRepo.dashboardPeriodStart('all', now), null);
});

test('salva lo stato preferito della lista', async (t) => {
  const db = require('../src/config/db');
  const originalQuery = db.query;
  let captured;
  t.after(() => { db.query = originalQuery; });
  db.query = async (text, values) => {
    captured = { text, values };
    return { rows: [{ id: 'list-1', is_favorite: true }] };
  };

  const list = await crmRepo.setListFavorite('list-1', true);

  assert.equal(list.is_favorite, true);
  assert.match(captured.text, /SET is_favorite=\$2/);
  assert.deepEqual(captured.values, ['list-1', true]);
});

test('ordina i contatti di una lista per ingresso in lista', async (t) => {
  const db = require('../src/config/db');
  const originalQuery = db.query;
  const captured = [];
  t.after(() => { db.query = originalQuery; });
  db.query = async (text) => {
    captured.push(text);
    if (/count\(\*\)::int AS count FROM crm_list_memberships/.test(text)) return { rows: [{ count: 0 }] };
    return { rows: [] };
  };

  await crmRepo.listContactsForList({ id: 'list-1' });

  assert.match(captured[0], /lm\.created_at AS list_joined_at/);
  assert.match(captured[0], /ORDER BY lm\.created_at DESC,c\.created_at DESC/);
});

test('aggiorna una sequenza con iscrizioni senza cancellare i passaggi', async (t) => {
  const db = require('../src/config/db');
  const originalGetClient = db.getClient;
  const calls = [];
  t.after(() => { db.getClient = originalGetClient; });
  db.getClient = async () => ({
    query: async (text) => {
      calls.push(text);
      if (/SELECT \* FROM crm_sequences/.test(text)) {
        return { rows: [{ id: 'sequence-1', trigger_type: 'manual', trigger_list_id: null, trigger_conditions: [] }] };
      }
      if (/SELECT count\(\*\)::int AS count FROM crm_sequence_enrollments/.test(text)) {
        return { rows: [{ count: 1 }] };
      }
      if (/UPDATE crm_sequences/.test(text)) return { rows: [{ id: 'sequence-1' }] };
      if (/SELECT id,position FROM crm_sequence_steps/.test(text)) {
        return { rows: [{ id: 'step-1', position: 0 }, { id: 'step-2', position: 1 }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  });

  await crmRepo.updateSequence('sequence-1', {
    name: 'Sequenza aggiornata',
    description: '',
    active: true,
    triggerType: 'manual',
    triggerListId: null,
    triggerConditions: [],
    steps: [
      { templateId: 'template-1', delayMinutes: 0 },
      { templateId: 'template-2', delayMinutes: 60 },
    ],
  });

  assert.equal(calls.some((query) => /DELETE FROM crm_sequence_steps/.test(query)), false);
  assert.equal(calls.filter((query) => /UPDATE crm_sequence_steps/.test(query)).length, 2);
});

test('include i contatti completati nei nuovi step solo su richiesta esplicita', async (t) => {
  const db = require('../src/config/db');
  const originalGetClient = db.getClient;
  const calls = [];
  t.after(() => { db.getClient = originalGetClient; });
  db.getClient = async () => ({
    query: async (text) => {
      calls.push(text);
      if (/SELECT \* FROM crm_sequences/.test(text)) {
        return { rows: [{ id: 'sequence-1', trigger_type: 'manual', trigger_list_id: null, trigger_conditions: [] }] };
      }
      if (/SELECT count\(\*\)::int AS count FROM crm_sequence_enrollments/.test(text)) {
        return { rows: [{ count: 21 }] };
      }
      if (/UPDATE crm_sequences/.test(text)) return { rows: [{ id: 'sequence-1' }] };
      if (/SELECT id,position FROM crm_sequence_steps/.test(text)) {
        return { rows: [{ id: 'step-1', position: 0 }] };
      }
      if (/WITH completed AS/.test(text)) {
        return { rows: [{ id: 'enrollment-1' }, { id: 'enrollment-2' }], rowCount: 2 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  });

  const sequence = await crmRepo.updateSequence('sequence-1', {
    name: 'Sequenza aggiornata',
    description: '',
    active: true,
    triggerType: 'manual',
    triggerListId: null,
    triggerConditions: [],
    steps: [
      { templateId: 'template-1', delayMinutes: 0 },
      { templateId: 'template-2', delayMinutes: 4320 },
    ],
  }, { includeCompletedEnrollments: true });

  assert.equal(sequence.resumedEnrollmentCount, 2);
  assert.equal(calls.some((query) => /INSERT INTO crm_email_jobs/.test(query)), true);
  assert.equal(calls.some((query) => /e\.status='completed'/.test(query)), true);
});

test('non include i contatti completati senza richiesta esplicita', async (t) => {
  const db = require('../src/config/db');
  const originalGetClient = db.getClient;
  const calls = [];
  t.after(() => { db.getClient = originalGetClient; });
  db.getClient = async () => ({
    query: async (text) => {
      calls.push(text);
      if (/SELECT \* FROM crm_sequences/.test(text)) {
        return { rows: [{ id: 'sequence-1', trigger_type: 'manual', trigger_list_id: null, trigger_conditions: [] }] };
      }
      if (/SELECT count\(\*\)::int AS count FROM crm_sequence_enrollments/.test(text)) {
        return { rows: [{ count: 21 }] };
      }
      if (/UPDATE crm_sequences/.test(text)) return { rows: [{ id: 'sequence-1' }] };
      if (/SELECT id,position FROM crm_sequence_steps/.test(text)) {
        return { rows: [{ id: 'step-1', position: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  });

  const sequence = await crmRepo.updateSequence('sequence-1', {
    name: 'Sequenza aggiornata',
    description: '',
    active: true,
    triggerType: 'manual',
    triggerListId: null,
    triggerConditions: [],
    steps: [
      { templateId: 'template-1', delayMinutes: 0 },
      { templateId: 'template-2', delayMinutes: 4320 },
    ],
  });

  assert.equal(sequence.resumedEnrollmentCount, 0);
  assert.equal(calls.some((query) => /WITH completed AS/.test(query)), false);
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
  assert.equal(result.contacts[0].emailStatus, 'subscribed');
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

test('imposta sempre come iscritti i contatti email importati da CSV', () => {
  const parsed = csvService.parseCsv('Email,Stato email\nanna@example.com,Disiscritto\n');
  const result = crmImportService.prepareImport(parsed);
  assert.equal(result.contacts[0].emailStatus, 'subscribed');
});

test('riconosce le intestazioni telefoniche abbreviate', () => {
  const parsed = csvService.parseCsv('Email,Tel.,Nome\nanna@example.com,+393331234567,Anna\n');
  const result = crmImportService.prepareImport(parsed);
  assert.equal(result.mapping.phone, 'Tel.');
  assert.equal(result.contacts[0].phoneNormalized, '+393331234567');
});
