const crmRepo = require('../repos/crmRepo');
const crmService = require('../services/crmService');
const crmImportService = require('../services/crmImportService');
const csvService = require('../services/csvService');
const emailService = require('../services/emailService');
const crmApiKeyRepo = require('../repos/crmApiKeyRepo');
const crmApiKeyService = require('../services/crmApiKeyService');

function pagination(query) {
  return {
    limit: Math.min(250, Math.max(1, Number(query.limit || 100))),
    offset: Math.max(0, Number(query.offset || 0)),
  };
}

async function getSummary(_req, res) {
  res.json({ summary: await crmRepo.summary() });
}

async function getEmailDashboard(_req, res) {
  res.json({ dashboard: await crmRepo.emailDashboard() });
}

async function listEmailLogs(req, res) {
  const filters = {
    status: String(req.query.status || '').trim() || null,
    kind: String(req.query.kind || '').trim() || null,
  };
  res.json(await crmRepo.listEmailJobs(filters, pagination(req.query)));
}

async function listContacts(req, res) {
  const result = await crmRepo.listContacts(crmService.contactFiltersFromQuery(req.query), pagination(req.query));
  res.json(result);
}

function contactTypeLabel(value) {
  if (value === 'parent') return 'Genitore';
  if (value === 'student') return 'Studente';
  return '';
}

function contactsCsv(contacts) {
  const headers = ['email', 'telefono', 'nome', 'cognome', 'origine', 'stato_email', 'stato_contatto',
    'genitore_studente', 'data_iscrizione_webinar', 'utm_source', 'utm_medium', 'utm_campaign',
    'utm_term', 'utm_content', 'tag', 'liste', 'campi_personalizzati'];
  const rows = contacts.map((contact) => ({
    email: contact.email || '',
    telefono: contact.phone || '',
    nome: contact.first_name || '',
    cognome: contact.last_name || '',
    origine: contact.source || '',
    stato_email: contact.email_status || '',
    stato_contatto: contact.contact_status_name || '',
    genitore_studente: contactTypeLabel(contact.contact_type),
    data_iscrizione_webinar: contact.webinar_registered_at || '',
    utm_source: contact.utm_source || '',
    utm_medium: contact.utm_medium || '',
    utm_campaign: contact.utm_campaign || '',
    utm_term: contact.utm_term || '',
    utm_content: contact.utm_content || '',
    tag: (contact.tags || []).join('|'),
    liste: (contact.lists || []).map((list) => list.name).join('|'),
    campi_personalizzati: JSON.stringify(contact.custom_fields || {}),
  }));
  return csvService.stringifyCsv(headers, rows);
}

function sendContactsCsv(res, filename, contacts) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(contactsCsv(contacts));
}

async function exportContacts(req, res) {
  const contacts = await crmRepo.exportContacts(crmService.contactFiltersFromQuery(req.query));
  sendContactsCsv(res, 'contatti-crm.csv', contacts);
}

async function bulkUpdateContacts(req, res) {
  const allMatching = req.body.allMatching === true;
  const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(String))] : [];
  if (!allMatching && !ids.length) return res.status(400).json({ error: 'Seleziona almeno un contatto' });
  if (ids.length > 1000) return res.status(400).json({ error: 'Puoi selezionare al massimo 1.000 contatti per operazione' });
  if (ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    return res.status(400).json({ error: 'Uno o più contatti non sono validi' });
  }
  const result = await crmRepo.bulkUpdateContacts({
    ids,
    filters: allMatching ? crmService.normalizeFilters(req.body.filters || {}) : null,
    changes: crmService.normalizeBulkContactChanges(req.body.changes || {}),
    actor: req.user.username,
  });
  res.json(result);
}

async function createContact(req, res) {
  const contact = await crmService.saveContact(req.body || {}, { actor: req.user.username });
  const listIds = crmService.normalizeListIds(req.body.listIds);
  if (listIds.length) await crmRepo.setContactLists(contact.id, listIds, req.user.username);
  res.status(201).json({ contact });
}

async function getContactProfile(req, res) {
  const profile = await crmRepo.getContactProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Contatto non trovato' });
  res.json(profile);
}

async function updateContact(req, res) {
  const existing = await crmRepo.getContact(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Contatto non trovato' });
  const normalized = crmService.normalizeContact({
    firstName: req.body.firstName === undefined ? existing.first_name : req.body.firstName,
    lastName: req.body.lastName === undefined ? existing.last_name : req.body.lastName,
    email: req.body.email === undefined ? existing.email : req.body.email,
    phone: req.body.phone === undefined ? existing.phone : req.body.phone,
    source: req.body.source === undefined ? existing.source : req.body.source,
    emailStatus: req.body.emailStatus === undefined ? existing.email_status : req.body.emailStatus,
    tags: req.body.tags === undefined ? existing.tags : req.body.tags,
    customFields: req.body.customFields === undefined ? existing.custom_fields : req.body.customFields,
    consentAt: req.body.consentAt === undefined ? existing.consent_at : req.body.consentAt,
    consentSource: req.body.consentSource === undefined ? existing.consent_source : req.body.consentSource,
    consentProof: req.body.consentProof === undefined ? existing.consent_proof : req.body.consentProof,
    contactStatusId: req.body.contactStatusId === undefined ? existing.contact_status_id : req.body.contactStatusId,
    contactType: req.body.contactType === undefined ? existing.contact_type : req.body.contactType,
    webinarRegisteredAt: req.body.webinarRegisteredAt === undefined
      ? existing.webinar_registered_at : req.body.webinarRegisteredAt,
    utmSource: req.body.utmSource === undefined ? existing.utm_source : req.body.utmSource,
    utmMedium: req.body.utmMedium === undefined ? existing.utm_medium : req.body.utmMedium,
    utmCampaign: req.body.utmCampaign === undefined ? existing.utm_campaign : req.body.utmCampaign,
    utmTerm: req.body.utmTerm === undefined ? existing.utm_term : req.body.utmTerm,
    utmContent: req.body.utmContent === undefined ? existing.utm_content : req.body.utmContent,
  });
  const contact = await crmRepo.updateContact(req.params.id, normalized, req.user.username);
  if (req.body.listIds !== undefined) {
    await crmRepo.setContactLists(contact.id, crmService.normalizeListIds(req.body.listIds), req.user.username);
  }
  res.json({ contact });
}

async function deleteContact(req, res) {
  const removed = await crmRepo.deleteContact(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Contatto non trovato' });
  res.status(204).end();
}

async function listLists(_req, res) {
  res.json({ lists: await crmRepo.listLists() });
}

async function createList(req, res) {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Il nome della lista è obbligatorio' });
  const list = await crmRepo.createList({
    name,
    description: String(req.body.description || '').trim(),
    createdBy: req.user.username,
  });
  res.status(201).json({ list });
}

async function updateList(req, res) {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Il nome della lista è obbligatorio' });
  const list = await crmRepo.updateList(req.params.id, {
    name,
    description: String(req.body.description || '').trim(),
  });
  if (!list) return res.status(404).json({ error: 'Lista non trovata' });
  res.json({ list });
}

async function listContactsInList(req, res) {
  const list = await crmRepo.getList(req.params.id);
  if (!list) return res.status(404).json({ error: 'Lista non trovata' });
  const result = await crmRepo.listContactsForList(list, pagination(req.query));
  res.json({ list, ...result });
}

async function exportContactsInList(req, res) {
  const list = await crmRepo.getList(req.params.id);
  if (!list) return res.status(404).json({ error: 'Lista non trovata' });
  const contacts = await crmRepo.exportContactsForList(list);
  const slug = list.name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'lista';
  sendContactsCsv(res, `contatti-${slug}.csv`, contacts);
}

async function addContactToList(req, res) {
  const list = await crmRepo.getList(req.params.id);
  if (!list) return res.status(404).json({ error: 'Lista non trovata' });
  let contactId = String(req.body.contactId || '').trim();
  if (!contactId) {
    const contact = await crmService.saveContact({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      phone: req.body.phone,
      source: req.body.source || 'manual',
      emailStatus: req.body.emailStatus || (req.body.email ? 'subscribed' : 'unknown'),
      contactType: req.body.contactType,
      tags: req.body.tags,
    }, { actor: req.user.username });
    contactId = contact.id;
  }
  const result = await crmRepo.addContactToList(req.params.id, contactId, 'manual', req.user.username);
  res.status(201).json(result);
}

function parseImportMapping(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw Object.assign(new Error('Invalid CSV column mapping'), { status: 400 });
  }
}

async function previewContactImport(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Seleziona un file CSV' });
  const parsed = csvService.parseCsv(req.file.buffer, { maxRows: 5000 });
  const prepared = crmImportService.prepareImport(parsed, {
    mapping: parseImportMapping(req.body.mapping),
    source: req.body.source,
    tags: req.body.tags,
  });
  res.json({
    filename: req.file.originalname,
    delimiter: parsed.delimiter,
    headers: parsed.headers,
    mapping: prepared.mapping,
    totalRows: parsed.rows.length,
    validCount: prepared.contacts.length,
    invalidCount: prepared.invalid.length,
    duplicateCount: prepared.duplicates.length,
    preview: prepared.contacts.slice(0, 8),
    invalid: prepared.invalid.slice(0, 20),
  });
}

async function importContacts(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Seleziona un file CSV' });
  const parsed = csvService.parseCsv(req.file.buffer, { maxRows: 5000 });
  const prepared = crmImportService.prepareImport(parsed, {
    mapping: parseImportMapping(req.body.mapping),
    source: req.body.source,
    tags: req.body.tags,
  });
  if (!prepared.contacts.length) {
    return res.status(400).json({ error: 'Il CSV non contiene contatti validi' });
  }
  const result = await crmRepo.importContacts(prepared.contacts, {
    listId: String(req.body.listId || '').trim() || null,
    actor: req.user.username,
  });
  res.status(201).json({
    ...result,
    invalid: prepared.invalid.length,
    duplicates: prepared.duplicates.length,
  });
}

async function deleteList(req, res) {
  const removed = await crmRepo.deleteList(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Lista non trovata' });
  res.status(204).end();
}

async function listContactStatuses(_req, res) {
  res.json({ statuses: await crmRepo.listContactStatuses() });
}

async function createContactStatus(req, res) {
  const name = String(req.body.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Il nome dello stato è obbligatorio' });
  try {
    const status = await crmRepo.createContactStatus(name);
    res.status(201).json({ status });
  } catch (error) {
    if (error.code === '23505') {
      throw Object.assign(new Error('Esiste già uno stato con questo nome'), { status: 409 });
    }
    throw error;
  }
}

async function deleteContactStatus(req, res) {
  const removed = await crmRepo.deleteContactStatus(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Stato contatto non trovato' });
  res.status(204).end();
}

function contentFolderInput(input = {}) {
  const kind = String(input.kind || '').trim();
  const name = String(input.name || '').trim().slice(0, 100);
  const description = String(input.description || '').trim().slice(0, 240);
  if (!['template', 'sequence'].includes(kind)) {
    throw Object.assign(new Error('Invalid content folder kind'), { status: 400 });
  }
  if (!name) throw Object.assign(new Error('Content folder name is required'), { status: 400 });
  return { kind, name, description };
}

async function listContentFolders(req, res) {
  const kind = String(req.query.kind || '').trim() || null;
  if (kind && !['template', 'sequence'].includes(kind)) {
    return res.status(400).json({ error: 'Tipo cartella non valido' });
  }
  res.json({ folders: await crmRepo.listContentFolders(kind) });
}

async function createContentFolder(req, res) {
  try {
    const folder = await crmRepo.createContentFolder({
      ...contentFolderInput(req.body),
      createdBy: req.user.username,
    });
    res.status(201).json({ folder });
  } catch (error) {
    if (error.code === '23505') {
      throw Object.assign(new Error('Esiste già una cartella con questo nome'), { status: 409 });
    }
    throw error;
  }
}

async function updateContentFolder(req, res) {
  try {
    const folder = await crmRepo.updateContentFolder(req.params.id, contentFolderInput(req.body));
    if (!folder) return res.status(404).json({ error: 'Cartella non trovata' });
    res.json({ folder });
  } catch (error) {
    if (error.code === '23505') {
      throw Object.assign(new Error('Esiste già una cartella con questo nome'), { status: 409 });
    }
    throw error;
  }
}

async function deleteContentFolder(req, res) {
  const removed = await crmRepo.deleteContentFolder(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Cartella non trovata' });
  res.status(204).end();
}

async function listTemplates(_req, res) {
  res.json({
    templates: await crmRepo.listTemplates(),
    variables: crmService.templateVariableCatalog(),
  });
}

async function createTemplate(req, res) {
  const template = await crmRepo.createTemplate({
    ...crmService.validateTemplate(req.body),
    createdBy: req.user.username,
  });
  res.status(201).json({ template });
}

async function updateTemplate(req, res) {
  const template = await crmRepo.updateTemplate(req.params.id, {
    ...crmService.validateTemplate(req.body),
    updatedBy: req.user.username,
  });
  if (!template) return res.status(404).json({ error: 'Template non trovato' });
  res.json({ template });
}

async function duplicateTemplate(req, res) {
  const template = await crmRepo.duplicateTemplate(req.params.id, req.user.username);
  if (!template) return res.status(404).json({ error: 'Template non trovato' });
  res.status(201).json({ template });
}

async function sendTemplateTest(req, res) {
  const to = crmService.normalizeEmail(req.body.to);
  if (!to) return res.status(400).json({ error: 'Test recipient is required' });
  const template = crmService.validateTemplate(req.body);
  const result = await emailService.sendTestEmail(to, template);
  res.json({ success: true, ...result });
}

async function deleteTemplate(req, res) {
  const removed = await crmRepo.deleteTemplate(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Template non trovato' });
  res.status(204).end();
}

async function listSequences(_req, res) {
  res.json({ sequences: await crmRepo.listSequences() });
}

async function listAutomations(_req, res) {
  res.json({ automations: await crmRepo.listAutomations() });
}

async function createAutomation(req, res) {
  const automation = await crmRepo.createAutomation({
    ...crmService.validateAutomation(req.body),
    createdBy: req.user.username,
  });
  res.status(201).json({ automation });
}

async function updateAutomation(req, res) {
  const automation = await crmRepo.updateAutomation(req.params.id, crmService.validateAutomation(req.body));
  if (!automation) return res.status(404).json({ error: 'Automazione non trovata' });
  res.json({ automation });
}

async function updateAutomationStatus(req, res) {
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Active status must be boolean' });
  const automation = await crmRepo.setAutomationActive(req.params.id, req.body.active);
  if (!automation) return res.status(404).json({ error: 'Automazione non trovata' });
  res.json({ automation });
}

async function deleteAutomation(req, res) {
  const removed = await crmRepo.deleteAutomation(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Automazione non trovata' });
  res.status(204).end();
}

async function listSequenceEnrollments(req, res) {
  const sequence = (await crmRepo.listSequences()).find((item) => item.id === req.params.id);
  if (!sequence) return res.status(404).json({ error: 'Sequenza non trovata' });
  const result = await crmRepo.listSequenceEnrollments(req.params.id, pagination(req.query));
  res.json({ sequence, ...result });
}

async function createSequence(req, res) {
  const sequence = await crmRepo.createSequence({
    ...crmService.validateSequence(req.body),
    createdBy: req.user.username,
  });
  res.status(201).json({ sequence });
}

async function duplicateSequence(req, res) {
  const sequence = await crmRepo.duplicateSequence(req.params.id, req.user.username);
  if (!sequence) return res.status(404).json({ error: 'Sequenza non trovata' });
  res.status(201).json({ sequence });
}

async function updateSequence(req, res) {
  const sequence = await crmRepo.updateSequence(
    req.params.id,
    crmService.validateSequence(req.body),
    { includeCompletedEnrollments: req.body.includeCompletedEnrollments === true }
  );
  if (!sequence) return res.status(404).json({ error: 'Sequenza non trovata' });
  res.json({ sequence });
}

async function updateSequenceStatus(req, res) {
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Active status must be boolean' });
  const sequence = await crmRepo.setSequenceActive(req.params.id, req.body.active);
  if (!sequence) return res.status(404).json({ error: 'Sequenza non trovata' });
  res.json({ sequence });
}

async function pauseSequence(req, res) {
  const sequence = await crmRepo.pauseSequence(req.params.id);
  if (!sequence) return res.status(404).json({ error: 'Sequenza non trovata' });
  res.json({ sequence });
}

async function updateEnrollmentStatus(req, res) {
  const status = String(req.body.status || '');
  if (!['active', 'paused', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Stato iscrizione non valido' });
  }
  const enrollment = await crmRepo.setEnrollmentStatus(req.params.id, req.params.enrollmentId, status);
  if (!enrollment) return res.status(404).json({ error: 'Iscrizione attiva non trovata' });
  res.json({ enrollment });
}

async function deleteSequence(req, res) {
  const removed = await crmRepo.deleteSequence(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Sequenza non trovata' });
  res.status(204).end();
}

async function ensureSender() {
  const settings = await emailService.getSettings();
  const { errors } = emailService.validateSettings({}, settings);
  if (errors.length) throw Object.assign(new Error('SMTP sender is not configured'), { status: 409 });
}

async function enrollList(req, res) {
  await ensureSender();
  const result = await crmRepo.enrollList(req.params.id, req.body.listId);
  if (!result) return res.status(404).json({ error: 'Sequenza o lista non trovata' });
  res.status(201).json(result);
}

async function listCampaigns(_req, res) {
  res.json({ campaigns: await crmRepo.listCampaigns() });
}

async function listCampaignJobs(req, res) {
  const campaign = (await crmRepo.listCampaigns()).find((item) => item.id === req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Invio non trovato' });
  const result = await crmRepo.listCampaignJobs(req.params.id, pagination(req.query));
  res.json({ campaign, ...result });
}

async function createCampaign(req, res) {
  await ensureSender();
  const name = String(req.body.name || '').trim();
  if (!name || !req.body.listId || !req.body.templateId) {
    return res.status(400).json({ error: 'Nome, lista e template sono obbligatori' });
  }
  const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : new Date();
  if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'Data di invio non valida' });
  if (scheduledAt.getTime() < Date.now() - 300_000) {
    return res.status(400).json({ error: 'La data programmata non può essere nel passato' });
  }
  const campaign = await crmRepo.createCampaign({
    name,
    listId: req.body.listId,
    templateId: req.body.templateId,
    scheduledAt: scheduledAt.toISOString(),
    createdBy: req.user.username,
  });
  if (!campaign) return res.status(404).json({ error: 'Lista o template non trovato' });
  res.status(201).json({ campaign });
}

async function previewCampaign(req, res) {
  const list = await crmRepo.getList(req.query.listId);
  const template = await crmRepo.getTemplate(req.query.templateId);
  if (!list || !template) return res.status(404).json({ error: 'Lista o template non trovato' });
  res.json({
    list: { id: list.id, name: list.name },
    template,
    eligibleCount: await crmRepo.countEligibleContactsForList(list),
  });
}

async function getSender(_req, res) {
  const settings = await emailService.getSettings();
  res.json({ settings: emailService.publicSettings(settings) });
}

async function updateSender(req, res) {
  const settings = await emailService.saveSettings(req.body || {}, req.user.username);
  res.json({ settings: emailService.publicSettings(settings) });
}

async function testSender(_req, res) {
  const result = await emailService.testConnection();
  res.json({ success: true, ...result });
}

async function processEmails(_req, res) {
  res.json(await emailService.processDueJobs());
}

async function listApiKeys(_req, res) {
  res.json({ keys: await crmApiKeyRepo.list(), scopes: [...crmApiKeyService.ALLOWED_SCOPES] });
}

async function createApiKey(req, res) {
  const result = await crmApiKeyService.create(req.body || {}, req.user.username);
  res.status(201).json(result);
}

async function rotateApiKey(req, res) {
  res.json(await crmApiKeyService.rotate(req.params.id));
}

async function revokeApiKey(req, res) {
  const key = await crmApiKeyRepo.revoke(req.params.id);
  if (!key) return res.status(404).json({ error: 'Chiave API non trovata' });
  res.json({ success: true });
}

module.exports = {
  getSummary,
  getEmailDashboard,
  listEmailLogs,
  listContacts,
  exportContacts,
  bulkUpdateContacts,
  createContact,
  getContactProfile,
  updateContact,
  deleteContact,
  previewContactImport,
  importContacts,
  listLists,
  createList,
  updateList,
  listContactsInList,
  exportContactsInList,
  addContactToList,
  deleteList,
  listContactStatuses,
  createContactStatus,
  deleteContactStatus,
  listContentFolders,
  createContentFolder,
  updateContentFolder,
  deleteContentFolder,
  listTemplates,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  sendTemplateTest,
  deleteTemplate,
  listAutomations,
  createAutomation,
  updateAutomation,
  updateAutomationStatus,
  deleteAutomation,
  listSequences,
  listSequenceEnrollments,
  createSequence,
  duplicateSequence,
  updateSequence,
  updateSequenceStatus,
  pauseSequence,
  updateEnrollmentStatus,
  deleteSequence,
  enrollList,
  listCampaigns,
  listCampaignJobs,
  previewCampaign,
  createCampaign,
  getSender,
  updateSender,
  testSender,
  processEmails,
  listApiKeys,
  createApiKey,
  rotateApiKey,
  revokeApiKey,
};
