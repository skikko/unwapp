const csvService = require('./csvService');
const crmService = require('./crmService');

const FIELD_ALIASES = {
  email: ['email', 'e_mail', 'mail', 'email_address', 'indirizzo_email'],
  phone: ['telefono', 'tel', 'phone', 'phone_number', 'cellulare', 'cell', 'cell_phone', 'mobile', 'mobile_phone', 'whatsapp', 'numero', 'numero_telefono'],
  firstName: ['nome', 'first_name', 'firstname', 'given_name'],
  lastName: ['cognome', 'last_name', 'lastname', 'surname', 'family_name'],
  source: ['origine', 'source', 'sorgente'],
  emailStatus: ['stato_email', 'email_status', 'consenso_email', 'subscription_status', 'marketing_consent'],
  tags: ['tag', 'tags', 'etichette'],
  webinarRegisteredAt: ['data_iscrizione_webinar', 'webinar_registered_at', 'registrazione'],
  contactType: ['genitore_studente', 'genitore_o_studente', 'tipo_contatto', 'contact_type'],
  utmSource: ['utm_source'],
  utmMedium: ['utm_medium'],
  utmCampaign: ['utm_campaign'],
  utmTerm: ['utm_term'],
  utmContent: ['utm_content'],
};

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function suggestMapping(headers) {
  const normalized = new Map(headers.map((header) => [normalizeHeader(header), header]));
  return Object.fromEntries(Object.entries(FIELD_ALIASES).map(([field, aliases]) => [
    field,
    aliases.map((alias) => normalized.get(alias)).find(Boolean) || '',
  ]));
}

function normalizeMapping(headers, input = {}) {
  const suggested = suggestMapping(headers);
  const mapping = {};
  for (const field of Object.keys(FIELD_ALIASES)) {
    const selected = String(input[field] || suggested[field] || '');
    mapping[field] = headers.includes(selected) ? selected : '';
  }
  return mapping;
}

function tagsFromRow(value) {
  return String(value || '').split(/[|,;]/).map((tag) => tag.trim()).filter(Boolean);
}

function prepareImport(parsed, options = {}) {
  const mapping = normalizeMapping(parsed.headers, options.mapping);
  if (!mapping.email && !mapping.phone) {
    throw Object.assign(new Error('Select at least one email or phone column'), { status: 400 });
  }
  const commonTags = crmService.normalizeTags(options.tags);
  const mappedHeaders = new Set(Object.values(mapping).filter(Boolean));
  const contacts = [];
  const invalid = [];
  const duplicates = [];
  const seenEmails = new Set();
  const seenPhones = new Set();

  for (const row of parsed.rows) {
    const data = row.data;
    const customFields = Object.fromEntries(
      Object.entries(data).filter(([header, value]) => !mappedHeaders.has(header) && String(value || '').trim())
    );
    try {
      const contact = crmService.normalizeContact({
        email: mapping.email ? data[mapping.email] : '',
        phone: mapping.phone ? data[mapping.phone] : '',
        firstName: mapping.firstName ? data[mapping.firstName] : '',
        lastName: mapping.lastName ? data[mapping.lastName] : '',
        source: mapping.source && data[mapping.source] ? data[mapping.source] : options.source || 'csv',
        emailStatus: mapping.emailStatus && data[mapping.emailStatus]
          ? normalizeEmailStatus(data[mapping.emailStatus])
          : 'unknown',
        tags: [...commonTags, ...tagsFromRow(mapping.tags ? data[mapping.tags] : '')],
        webinarRegisteredAt: mapping.webinarRegisteredAt ? data[mapping.webinarRegisteredAt] : '',
        contactType: mapping.contactType ? data[mapping.contactType] : '',
        utmSource: mapping.utmSource ? data[mapping.utmSource] : '',
        utmMedium: mapping.utmMedium ? data[mapping.utmMedium] : '',
        utmCampaign: mapping.utmCampaign ? data[mapping.utmCampaign] : '',
        utmTerm: mapping.utmTerm ? data[mapping.utmTerm] : '',
        utmContent: mapping.utmContent ? data[mapping.utmContent] : '',
        customFields,
      }, { defaultSource: 'csv' });
      const duplicateEmail = contact.emailNormalized && seenEmails.has(contact.emailNormalized);
      const duplicatePhone = contact.phoneNormalized && seenPhones.has(contact.phoneNormalized);
      if (duplicateEmail || duplicatePhone) {
        duplicates.push({ rowNumber: row.rowNumber, value: contact.emailNormalized || contact.phoneNormalized });
        continue;
      }
      if (contact.emailNormalized) seenEmails.add(contact.emailNormalized);
      if (contact.phoneNormalized) seenPhones.add(contact.phoneNormalized);
      contacts.push({ ...contact, rowNumber: row.rowNumber });
    } catch (error) {
      invalid.push({ rowNumber: row.rowNumber, error: error.message });
    }
  }
  return { mapping, contacts, invalid, duplicates };
}

function normalizeEmailStatus(value) {
  const normalized = normalizeHeader(value);
  const aliases = {
    iscritto: 'subscribed',
    subscribed: 'subscribed',
    attivo: 'subscribed',
    accepted: 'subscribed',
    accettato: 'subscribed',
    disiscritto: 'unsubscribed',
    unsubscribed: 'unsubscribed',
    rejected: 'unsubscribed',
    rifiutato: 'unsubscribed',
    bounced: 'bounced',
    non_recapitabile: 'bounced',
    unknown: 'unknown',
    sconosciuto: 'unknown',
  };
  return aliases[normalized] || normalized;
}

module.exports = { suggestMapping, normalizeMapping, prepareImport, normalizeEmailStatus };
