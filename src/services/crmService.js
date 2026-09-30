const crmRepo = require('../repos/crmRepo');
const sanitizeHtml = require('sanitize-html');

const EMAIL_STATUSES = new Set(['unknown', 'subscribed', 'unsubscribed', 'bounced']);
const CONTACT_TYPES = new Map([
  ['genitore', 'parent'],
  ['parent', 'parent'],
  ['studente', 'student'],
  ['student', 'student'],
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('Invalid email address'), { status: 400 });
  }
  return email;
}

function normalizePhone(value) {
  const raw = String(value || '').trim().replace(/^whatsapp:/i, '');
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    throw Object.assign(new Error('Invalid phone number'), { status: 400 });
  }
  return `+${digits}`;
}

function normalizeTags(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(input.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 50);
}

function normalizeOptionalText(value, maxLength = 255) {
  return String(value || '').trim().slice(0, maxLength) || null;
}

function normalizeContactType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  const contactType = CONTACT_TYPES.get(normalized);
  if (!contactType) throw Object.assign(new Error('Invalid contact type'), { status: 400 });
  return contactType;
}

function normalizeWebinarDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const italian = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = italian
    ? `${italian[3]}-${italian[2].padStart(2, '0')}-${italian[1].padStart(2, '0')}`
    : raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw Object.assign(new Error('Invalid webinar registration date'), { status: 400 });
  }
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw Object.assign(new Error('Invalid webinar registration date'), { status: 400 });
  }
  return iso;
}

function normalizeContactStatusId(value) {
  const id = String(value || '').trim();
  if (!id) return null;
  if (!UUID_PATTERN.test(id)) throw Object.assign(new Error('Invalid contact status'), { status: 400 });
  return id;
}

function normalizeFilters(value = {}) {
  const filters = {};
  if (value.query) filters.query = String(value.query).trim().slice(0, 120);
  if (value.source) filters.source = String(value.source).trim().slice(0, 80);
  if (EMAIL_STATUSES.has(value.emailStatus)) filters.emailStatus = value.emailStatus;
  if (value.contactStatusId) filters.contactStatusId = normalizeContactStatusId(value.contactStatusId);
  if (value.hasEmail === true || value.hasEmail === false) filters.hasEmail = value.hasEmail;
  if (value.hasPhone === true || value.hasPhone === false) filters.hasPhone = value.hasPhone;
  const tags = normalizeTags(value.tags);
  if (tags.length) filters.tags = tags;
  if (value.createdFrom) {
    const createdFrom = new Date(value.createdFrom);
    if (Number.isNaN(createdFrom.getTime())) throw Object.assign(new Error('Invalid start date'), { status: 400 });
    filters.createdFrom = createdFrom.toISOString();
  }
  if (value.createdTo) {
    const createdTo = new Date(value.createdTo);
    if (Number.isNaN(createdTo.getTime())) throw Object.assign(new Error('Invalid end date'), { status: 400 });
    filters.createdTo = createdTo.toISOString();
  }
  return filters;
}

function normalizeContact(input = {}, { defaultSource = 'manual' } = {}) {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (!email && !phone) {
    throw Object.assign(new Error('Email or phone is required'), { status: 400 });
  }
  const emailStatus = email ? (input.emailStatus || 'unknown') : 'unknown';
  if (emailStatus && !EMAIL_STATUSES.has(emailStatus)) {
    throw Object.assign(new Error('Invalid email status'), { status: 400 });
  }
  const customFields = input.customFields && typeof input.customFields === 'object' && !Array.isArray(input.customFields)
    ? input.customFields
    : {};
  let consentAt = null;
  if (input.consentAt) {
    const parsed = new Date(input.consentAt);
    if (Number.isNaN(parsed.getTime())) {
      throw Object.assign(new Error('Invalid consent date'), { status: 400 });
    }
    consentAt = parsed.toISOString();
  }
  const consentProof = input.consentProof && typeof input.consentProof === 'object'
    && !Array.isArray(input.consentProof) ? input.consentProof : {};
  return {
    firstName: input.firstName === undefined ? null : String(input.firstName).trim().slice(0, 120) || null,
    lastName: input.lastName === undefined ? null : String(input.lastName).trim().slice(0, 120) || null,
    email,
    emailNormalized: email,
    phone,
    phoneNormalized: phone,
    source: String(input.source || defaultSource).trim().slice(0, 80) || defaultSource,
    emailStatus,
    tags: normalizeTags(input.tags),
    customFields,
    consentAt,
    consentSource: String(input.consentSource || '').trim().slice(0, 120) || null,
    consentProof,
    contactStatusId: normalizeContactStatusId(input.contactStatusId ?? input.contact_status_id),
    contactType: normalizeContactType(input.contactType ?? input.contact_type),
    webinarRegisteredAt: normalizeWebinarDate(input.webinarRegisteredAt ?? input.webinar_registered_at),
    utmSource: normalizeOptionalText(input.utmSource ?? input.utm_source),
    utmMedium: normalizeOptionalText(input.utmMedium ?? input.utm_medium),
    utmCampaign: normalizeOptionalText(input.utmCampaign ?? input.utm_campaign),
    utmTerm: normalizeOptionalText(input.utmTerm ?? input.utm_term),
    utmContent: normalizeOptionalText(input.utmContent ?? input.utm_content),
  };
}

async function saveContact(input, options) {
  return crmRepo.upsertContact(normalizeContact(input, options), { actor: options?.actor || null });
}

function validateTemplate(input = {}) {
  const template = {
    name: String(input.name || '').trim(),
    subject: String(input.subject || '').trim().replace(/[\r\n]+/g, ' '),
    preheader: String(input.preheader || '').trim(),
    htmlBody: sanitizeEmailHtml(input.htmlBody),
    textBody: String(input.textBody || '').trim(),
  };
  if (!template.name || !template.subject || !template.htmlBody) {
    throw Object.assign(new Error('Template name, subject and HTML body are required'), { status: 400 });
  }
  return template;
}

function sanitizeEmailHtml(value) {
  return sanitizeHtml(String(value || ''), {
    allowedTags: [
      'a', 'blockquote', 'br', 'div', 'em', 'h1', 'h2', 'h3', 'hr', 'img', 'li',
      'ol', 'p', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'title', 'style'],
      img: ['src', 'alt', 'title', 'width', 'height', 'style'],
      '*': ['style'],
      table: ['cellpadding', 'cellspacing', 'border', 'width'],
      td: ['colspan', 'rowspan', 'width'],
      th: ['colspan', 'rowspan', 'width'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i],
        'font-size': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        'font-weight': [/^(?:normal|bold|[1-9]00)$/],
        'font-style': [/^(?:normal|italic)$/],
        'text-align': [/^(?:left|center|right|justify)$/],
        'text-decoration': [/^(?:none|underline|line-through)$/],
        display: [/^(?:block|inline|inline-block)$/],
        width: [/^(?:auto|\d+(?:\.\d+)?(?:px|%))$/],
        'max-width': [/^(?:none|\d+(?:\.\d+)?(?:px|%))$/],
        height: [/^(?:auto|\d+(?:\.\d+)?px)$/],
        margin: [/^[\d.\s%-]+(?:auto)?$/],
        padding: [/^[\d.\s%-]+$/],
      },
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: 'noopener noreferrer' },
      }),
    },
  }).trim();
}

function validateSequence(input = {}) {
  const name = String(input.name || '').trim();
  const steps = Array.isArray(input.steps) ? input.steps.map((step) => ({
    templateId: String(step.templateId || ''),
    delayMinutes: Math.max(0, Math.floor(Number(step.delayMinutes || 0))),
  })) : [];
  const triggerType = input.trigger?.type === 'list_joined' ? 'list_joined' : 'manual';
  const triggerListId = triggerType === 'list_joined' ? String(input.trigger?.listId || '').trim() : null;
  if (!name || !steps.length || steps.some((step) => !step.templateId)) {
    throw Object.assign(new Error('Sequence name and at least one valid step are required'), { status: 400 });
  }
  if (triggerType === 'list_joined' && !triggerListId) {
    throw Object.assign(new Error('A list is required for the selected trigger'), { status: 400 });
  }
  return {
    name,
    description: String(input.description || '').trim(),
    active: input.active !== false,
    triggerType,
    triggerListId,
    steps,
  };
}

function normalizeBulkContactChanges(input = {}) {
  const emailStatus = String(input.emailStatus || '').trim() || null;
  if (emailStatus && !EMAIL_STATUSES.has(emailStatus)) {
    throw Object.assign(new Error('Invalid email status'), { status: 400 });
  }
  const listAction = ['add', 'remove'].includes(input.listAction) ? input.listAction : null;
  const listId = listAction ? String(input.listId || '').trim() : null;
  if (listAction && !listId) {
    throw Object.assign(new Error('A list is required for the selected bulk action'), { status: 400 });
  }
  const changes = {
    source: String(input.source || '').trim().slice(0, 80) || null,
    emailStatus,
    addTags: normalizeTags(input.addTags),
    removeTags: normalizeTags(input.removeTags),
    listAction,
    listId,
    contactStatusChanged: Object.prototype.hasOwnProperty.call(input, 'contactStatusId'),
    contactStatusId: Object.prototype.hasOwnProperty.call(input, 'contactStatusId')
      ? normalizeContactStatusId(input.contactStatusId) : null,
  };
  if (!changes.source && !changes.emailStatus && !changes.addTags.length
      && !changes.removeTags.length && !changes.listAction && !changes.contactStatusChanged) {
    throw Object.assign(new Error('At least one bulk change is required'), { status: 400 });
  }
  return changes;
}

function contactFiltersFromQuery(query = {}) {
  return normalizeFilters({
    query: query.query,
    source: query.source,
    emailStatus: query.emailStatus,
    contactStatusId: query.contactStatusId,
    hasEmail: query.hasEmail === undefined ? undefined : query.hasEmail === 'true',
    hasPhone: query.hasPhone === undefined ? undefined : query.hasPhone === 'true',
    tags: query.tags,
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
  });
}

module.exports = {
  normalizeEmail,
  normalizePhone,
  normalizeTags,
  normalizeContactType,
  normalizeWebinarDate,
  normalizeFilters,
  normalizeContact,
  saveContact,
  sanitizeEmailHtml,
  validateTemplate,
  validateSequence,
  normalizeBulkContactChanges,
  contactFiltersFromQuery,
};
