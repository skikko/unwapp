const crmRepo = require('../repos/crmRepo');
const sanitizeHtml = require('sanitize-html');

const EMAIL_STATUSES = new Set(['unknown', 'subscribed', 'unsubscribed', 'bounced']);
const TEMPLATE_TYPES = new Set(['marketing', 'transactional']);
const TEMPLATE_EDITOR_MODES = new Set(['visual', 'html']);
const TEMPLATE_BLOCK_TYPES = new Set([
  'heading', 'text', 'image', 'button', 'logo', 'divider', 'spacer', 'columns', 'social', 'html',
]);
const TEMPLATE_VARIABLE_CATALOG = Object.freeze([
  { key: 'first_name', group: 'Contatto', label: 'Nome', example: 'Mario', type: 'text' },
  { key: 'last_name', group: 'Contatto', label: 'Cognome', example: 'Rossi', type: 'text' },
  { key: 'full_name', group: 'Contatto', label: 'Nome completo', example: 'Mario Rossi', type: 'text' },
  { key: 'email', group: 'Contatto', label: 'Email', example: 'mario.rossi@example.com', type: 'text' },
  { key: 'phone', group: 'Contatto', label: 'Telefono', example: '+393331234567', type: 'text' },
  { key: 'source', group: 'Contatto', label: 'Sorgente', example: 'newsletter', type: 'text' },
  { key: 'recontact_url', group: 'Azioni', label: 'URL ricontatto', example: 'https://www.unitednetwork.it/grazie-ricontatto/', type: 'url' },
]);
const CONTACT_TYPES = new Map([
  ['genitore', 'parent'],
  ['parent', 'parent'],
  ['studente', 'student'],
  ['student', 'student'],
]);
const MEDIA_URL_PATTERN = /(?:https?:\/\/[^"'<>\s]+)?\/media\/([A-Za-z0-9_-]{40,60})(?:\/[^"'<>\s]*)?/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEQUENCE_CONDITION_FIELDS = new Map([
  ['contactType', new Set(['equals', 'not_equals'])],
  ['contactStatusId', new Set(['equals', 'not_equals'])],
  ['emailStatus', new Set(['equals', 'not_equals'])],
  ['source', new Set(['equals', 'not_equals', 'contains'])],
  ['firstName', new Set(['equals', 'not_equals', 'contains'])],
  ['lastName', new Set(['equals', 'not_equals', 'contains'])],
  ['email', new Set(['equals', 'not_equals', 'contains'])],
  ['phone', new Set(['equals', 'not_equals', 'contains'])],
  ['tags', new Set(['contains', 'not_contains'])],
  ['webinarRegisteredAt', new Set(['equals', 'before', 'after', 'is_set', 'is_not_set'])],
  ['utmSource', new Set(['equals', 'not_equals', 'contains'])],
  ['utmMedium', new Set(['equals', 'not_equals', 'contains'])],
  ['utmCampaign', new Set(['equals', 'not_equals', 'contains'])],
  ['utmTerm', new Set(['equals', 'not_equals', 'contains'])],
  ['utmContent', new Set(['equals', 'not_equals', 'contains'])],
]);
const AUTOMATION_CONDITION_FIELDS = new Map([
  ['contactType', new Set(['equals', 'not_equals', 'is_set', 'is_not_set'])],
  ['contactStatusId', new Set(['equals', 'not_equals', 'is_set', 'is_not_set'])],
  ['emailStatus', new Set(['equals', 'not_equals'])],
  ['source', new Set(['equals', 'not_equals', 'contains', 'is_set', 'is_not_set'])],
  ['firstName', new Set(['equals', 'not_equals', 'contains', 'is_set', 'is_not_set'])],
  ['lastName', new Set(['equals', 'not_equals', 'contains', 'is_set', 'is_not_set'])],
  ['email', new Set(['equals', 'not_equals', 'contains', 'is_set', 'is_not_set'])],
  ['phone', new Set(['equals', 'not_equals', 'contains', 'is_set', 'is_not_set'])],
  ['tags', new Set(['contains', 'not_contains', 'is_set', 'is_not_set'])],
  ['webinarRegisteredAt', new Set(['equals', 'before', 'after', 'is_set', 'is_not_set'])],
  ['utmSource', new Set(['equals', 'not_equals', 'contains', 'is_set', 'is_not_set'])],
  ['utmMedium', new Set(['equals', 'not_equals', 'contains', 'is_set', 'is_not_set'])],
  ['utmCampaign', new Set(['equals', 'not_equals', 'contains', 'is_set', 'is_not_set'])],
  ['utmTerm', new Set(['equals', 'not_equals', 'contains', 'is_set', 'is_not_set'])],
  ['utmContent', new Set(['equals', 'not_equals', 'contains', 'is_set', 'is_not_set'])],
]);

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

function normalizeUuid(value, label) {
  const id = String(value || '').trim();
  if (!id) return null;
  if (!UUID_PATTERN.test(id)) throw Object.assign(new Error(`Invalid ${label}`), { status: 400 });
  return id;
}

function normalizeFolderId(value) {
  return normalizeUuid(value, 'content folder');
}

function normalizeListIds(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(items.map((item) => normalizeUuid(item, 'list')).filter(Boolean))].slice(0, 100);
}

function normalizeFilters(value = {}) {
  const filters = {};
  if (value.query) filters.query = String(value.query).trim().slice(0, 120);
  if (value.source) filters.source = String(value.source).trim().slice(0, 80);
  if (EMAIL_STATUSES.has(value.emailStatus)) filters.emailStatus = value.emailStatus;
  if (value.contactStatusId) filters.contactStatusId = normalizeContactStatusId(value.contactStatusId);
  if (value.contactType) filters.contactType = normalizeContactType(value.contactType);
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
  const templateType = TEMPLATE_TYPES.has(input.templateType) ? input.templateType : 'marketing';
  const editorMode = TEMPLATE_EDITOR_MODES.has(input.editorMode) ? input.editorMode : 'visual';
  const inputVersion = Number(input.version);
  const subject = String(input.subject || '').trim().replace(/[\r\n]+/g, ' ');
  const preheader = String(input.preheader || '').trim();
  const builderModel = normalizeTemplateBuilderModel(input.builderModel);
  const htmlBody = editorMode === 'visual' && builderModel
    ? renderTemplateBuilderHtml(builderModel, { subject, preheader })
    : sanitizeEmailHtml(input.htmlBody);
  const template = {
    name: String(input.name || '').trim(),
    slug: templateSlug(input.name),
    templateType,
    editorMode,
    subject,
    preheader,
    htmlBody,
    textBody: String(input.textBody || '').trim(),
    builderModel,
    description: String(input.description || '').trim().slice(0, 1000),
    tags: normalizeTags(input.tags),
    version: Number.isFinite(inputVersion) ? Math.max(1, Math.floor(inputVersion)) : 1,
    attachments: normalizeTemplateAttachments(input.attachments),
    folderId: normalizeFolderId(input.folderId),
  };
  if (!template.name || !template.subject || !template.htmlBody) {
    throw Object.assign(new Error('Template name, subject and HTML body are required'), { status: 400 });
  }
  return template;
}

function templateSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'template';
}

function normalizeTemplateBuilderModel(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Invalid template builder model'), { status: 400 });
  }
  const blocks = Array.isArray(value.blocks) ? value.blocks : [];
  if (blocks.length > 200) {
    throw Object.assign(new Error('Template builder supports at most 200 blocks'), { status: 400 });
  }
  const ids = new Set();
  const normalizedBlocks = blocks.map((block) => {
    const id = String(block?.id || '').trim();
    const rawType = String(block?.type || '').trim();
    const type = rawType === 'title' ? 'heading' : rawType;
    if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id) || ids.has(id) || !TEMPLATE_BLOCK_TYPES.has(type)) {
      throw Object.assign(new Error('Invalid template builder block'), { status: 400 });
    }
    ids.add(id);
    return {
      id,
      type,
      style: normalizeTemplateBlockStyle(block.style),
      html: sanitizeEmailHtml(block.html),
    };
  });
  const style = value.globalStyle && typeof value.globalStyle === 'object' && !Array.isArray(value.globalStyle)
    ? value.globalStyle : {};
  const model = {
    schemaVersion: 2,
    globalStyle: normalizeTemplateGlobalStyle(style),
    blocks: normalizedBlocks,
  };
  if (JSON.stringify(model).length > 400_000) {
    throw Object.assign(new Error('Template builder model is too large'), { status: 413 });
  }
  return model;
}

function normalizeTemplateBlockStyle(value = {}) {
  const align = ['left', 'center', 'right'].includes(value?.align) ? value.align : null;
  const number = (candidate) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(160, Math.max(0, Math.round(parsed))) : 0;
  };
  const backgroundColor = value?.backgroundColor === null
    ? null
    : /^#[0-9a-f]{6}$/i.test(String(value?.backgroundColor || ''))
      ? String(value.backgroundColor).toLowerCase()
      : null;
  return {
    align,
    paddingTop: number(value?.paddingTop),
    paddingBottom: number(value?.paddingBottom),
    backgroundColor,
    hideOnMobile: value?.hideOnMobile === true,
  };
}

function normalizeTemplateGlobalStyle(value = {}) {
  const color = (candidate, fallback) => /^#[0-9a-f]{6}$/i.test(String(candidate || ''))
    ? String(candidate).toLowerCase() : fallback;
  const number = (candidate, minimum, maximum, fallback) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
  };
  const fonts = new Set(['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Verdana', 'Trebuchet MS', 'Tahoma']);
  return {
    backgroundColor: color(value.backgroundColor, '#f1f5f9'),
    contentBackgroundColor: color(value.contentBackgroundColor, '#ffffff'),
    contentWidth: number(value.contentWidth, 480, 800, 600),
    fontFamily: fonts.has(value.fontFamily) ? value.fontFamily : 'Arial',
    textColor: color(value.textColor, '#1a1a1a'),
    linkColor: color(value.linkColor, '#85294f'),
    paddingX: number(value.paddingX, 0, 100, 40),
    paddingY: number(value.paddingY, 0, 120, 28),
  };
}

function escapeEmailMarkup(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function renderTemplateBuilderHtml(model, envelope = {}) {
  const style = normalizeTemplateGlobalStyle(model?.globalStyle || {});
  const blocks = Array.isArray(model?.blocks) ? model.blocks : [];
  const fontFamily = ['Georgia', 'Times New Roman'].includes(style.fontFamily)
    ? `${style.fontFamily}, serif`
    : `${style.fontFamily}, Helvetica, sans-serif`;
  const rows = blocks.map((block, index) => {
    const blockStyle = normalizeTemplateBlockStyle(block.style);
    const paddingTop = blockStyle.paddingTop + (index === 0 ? style.paddingY : 0);
    const paddingBottom = blockStyle.paddingBottom + (index === blocks.length - 1 ? style.paddingY : 0);
    const classes = ['email-block', `email-block-${block.type}`];
    if (blockStyle.hideOnMobile) classes.push('email-hide-mobile');
    const cellStyles = [
      `padding:${paddingTop}px ${style.paddingX}px ${paddingBottom}px`,
      `color:${style.textColor}`,
      `font-family:${fontFamily}`,
    ];
    if (blockStyle.align) cellStyles.push(`text-align:${blockStyle.align}`);
    if (blockStyle.backgroundColor) cellStyles.push(`background-color:${blockStyle.backgroundColor}`);
    return `<tr><td class="${classes.join(' ')}" style="${cellStyles.join(';')}">${block.html}</td></tr>`;
  }).join('');
  const subject = escapeEmailMarkup(envelope.subject || '');
  const preheader = escapeEmailMarkup(envelope.preheader || '');
  const hiddenPreview = '&nbsp;&zwnj;'.repeat(24);
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${subject}</title><style>@media only screen and (max-width:600px){.email-inner{width:100%!important;max-width:100%!important}.email-block{padding-left:20px!important;padding-right:20px!important}.email-hide-mobile{display:none!important;max-height:0!important;overflow:hidden!important}.email-block-columns table,.email-block-columns tbody,.email-block-columns tr,.email-block-columns td{display:block!important;width:100%!important;box-sizing:border-box!important}img{max-width:100%!important;height:auto!important}}</style></head><body style="margin:0;padding:0;background-color:${style.backgroundColor};color:${style.textColor};font-family:${fontFamily}"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}${hiddenPreview}</div><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:${style.backgroundColor}"><tbody><tr><td align="center"><!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${style.contentWidth}"><tr><td><![endif]--><table class="email-inner" role="presentation" cellpadding="0" cellspacing="0" border="0" width="${style.contentWidth}" style="width:${style.contentWidth}px;max-width:${style.contentWidth}px;background-color:${style.contentBackgroundColor};color:${style.textColor};font-family:${fontFamily}"><tbody>${rows}</tbody></table><!--[if mso]></td></tr></table><![endif]--></td></tr></tbody></table></body></html>`;
}

function templateVariableCatalog() {
  return TEMPLATE_VARIABLE_CATALOG.map((variable) => ({ ...variable }));
}

function normalizeTemplateAttachments(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10) {
    throw Object.assign(new Error('Template attachments must be an array with at most 10 items'), { status: 400 });
  }
  return value.map((item) => {
    const url = String(item?.url || '').trim();
    if (!MEDIA_URL_PATTERN.test(url)) {
      throw Object.assign(new Error('Invalid template attachment URL'), { status: 400 });
    }
    return {
      url,
      name: String(item?.name || 'allegato').trim().slice(0, 180) || 'allegato',
      type: String(item?.type || '').trim().slice(0, 120) || null,
      size: Math.max(0, Math.floor(Number(item?.size || 0))),
    };
  });
}

function sanitizeEmailHtml(value) {
  const sanitized = sanitizeHtml(String(value || ''), {
    allowedTags: [
      'a', 'blockquote', 'body', 'br', 'div', 'em', 'h1', 'h2', 'h3', 'head', 'hr', 'html', 'img', 'li',
      'meta', 'ol', 'p', 's', 'span', 'strong', 'style', 'table', 'tbody', 'td', 'th', 'thead', 'title', 'tr', 'u', 'ul',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'title', 'style'],
      html: ['lang'],
      meta: ['charset', 'name', 'content'],
      img: ['src', 'alt', 'title', 'width', 'height', 'style'],
      '*': ['style', 'class'],
      table: ['cellpadding', 'cellspacing', 'border', 'width', 'role', 'bgcolor'],
      td: ['align', 'bgcolor', 'colspan', 'rowspan', 'valign', 'width'],
      th: ['colspan', 'rowspan', 'width'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowVulnerableTags: true,
    allowProtocolRelative: false,
    allowedClasses: {
      '*': ['email-hide-mobile'],
    },
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i],
        'font-size': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        'font-weight': [/^(?:normal|bold|[1-9]00)$/],
        'font-style': [/^(?:normal|italic)$/],
        'font-family': [/^[a-z0-9 ,"'-]+$/i],
        'line-height': [/^(?:normal|\d+(?:\.\d+)?(?:px|em|rem|%)?)$/],
        'letter-spacing': [/^-?\d+(?:\.\d+)?(?:px|em|rem)$/],
        'text-align': [/^(?:left|center|right|justify)$/],
        'text-decoration': [/^(?:none|underline|line-through)$/],
        display: [/^(?:block|inline|inline-block)$/],
        width: [/^(?:auto|\d+(?:\.\d+)?(?:px|%))$/],
        'max-width': [/^(?:none|\d+(?:\.\d+)?(?:px|%))$/],
        height: [/^(?:auto|\d+(?:\.\d+)?px)$/],
        margin: [/^(?:-?\d+(?:\.\d+)?(?:px|em|rem|%)?|auto)(?:\s+(?:-?\d+(?:\.\d+)?(?:px|em|rem|%)?|auto)){0,3}$/],
        padding: [/^\d+(?:\.\d+)?(?:px|em|rem|%)?(?:\s+\d+(?:\.\d+)?(?:px|em|rem|%)?){0,3}$/],
        border: [/^(?:0|\d+(?:\.\d+)?px\s+(?:solid|dashed)\s+#[0-9a-f]{3,8})$/i],
        'border-top': [/^(?:0|\d+(?:\.\d+)?px\s+(?:solid|dashed)\s+#[0-9a-f]{3,8})$/i],
        'border-bottom': [/^(?:0|\d+(?:\.\d+)?px\s+(?:solid|dashed)\s+#[0-9a-f]{3,8})$/i],
        'border-radius': [/^\d+(?:\.\d+)?(?:px|%)$/],
        'vertical-align': [/^(?:top|middle|bottom)$/],
        'box-sizing': [/^border-box$/],
      },
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, rel: 'noopener noreferrer' },
      }),
    },
  }).trim();
  const withoutUnsafeCss = sanitized.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_match, attributes, css) => {
    const safeCss = css
      .replace(/@import[\s\S]*?;/gi, '')
      .replace(/(?:expression|behavior|-moz-binding)\s*:[^;}]*[;}]/gi, '')
      .replace(/url\([^)]*\)/gi, '');
    return `<style${attributes}>${safeCss}</style>`;
  });
  return /^<html[\s>]/i.test(withoutUnsafeCss) ? `<!doctype html>${withoutUnsafeCss}` : withoutUnsafeCss;
}

function validateSequence(input = {}) {
  const name = String(input.name || '').trim();
  const steps = Array.isArray(input.steps) ? input.steps.map((step) => ({
    templateId: String(step.templateId || ''),
    delayMinutes: Math.max(0, Math.floor(Number(step.delayMinutes || 0))),
  })) : [];
  const triggerType = input.trigger?.type === 'list_joined' ? 'list_joined' : 'manual';
  const triggerListId = triggerType === 'list_joined' ? String(input.trigger?.listId || '').trim() : null;
  const triggerConditions = triggerType === 'list_joined'
    ? normalizeSequenceConditions(input.trigger?.conditions)
    : [];
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
    triggerConditions,
    folderId: normalizeFolderId(input.folderId),
    steps,
  };
}

function normalizeAutomationCondition(value = {}) {
  const field = String(value?.field || '').trim();
  const operator = String(value?.operator || '').trim();
  const operators = AUTOMATION_CONDITION_FIELDS.get(field);
  if (!operators || !operators.has(operator)) {
    throw Object.assign(new Error('Invalid automation trigger condition'), { status: 400 });
  }
  if (operator === 'is_set' || operator === 'is_not_set') return { field, operator, value: null };
  let normalizedValue = String(value?.value || '').trim();
  if (!normalizedValue) {
    throw Object.assign(new Error('A value is required for the automation trigger condition'), { status: 400 });
  }
  if (field === 'contactType') normalizedValue = normalizeContactType(normalizedValue);
  if (field === 'contactStatusId') normalizedValue = normalizeContactStatusId(normalizedValue);
  if (field === 'emailStatus' && !EMAIL_STATUSES.has(normalizedValue)) {
    throw Object.assign(new Error('Invalid email status in automation trigger condition'), { status: 400 });
  }
  if (field === 'webinarRegisteredAt') normalizedValue = normalizeWebinarDate(normalizedValue);
  if (field === 'tags') normalizedValue = normalizeTags([normalizedValue])[0];
  if (!normalizedValue) {
    throw Object.assign(new Error('A value is required for the automation trigger condition'), { status: 400 });
  }
  return { field, operator, value: normalizedValue.slice(0, 255) };
}

function validateAutomation(input = {}) {
  const name = String(input.name || '').trim();
  const triggerType = input.trigger?.type === 'list_joined' ? 'list_joined' : 'contact_saved';
  const triggerListId = triggerType === 'list_joined' ? normalizeUuid(input.trigger?.listId, 'list') : null;
  const triggerCondition = triggerType === 'contact_saved'
    ? normalizeAutomationCondition(input.trigger?.condition)
    : null;
  const actions = Array.isArray(input.actions) ? input.actions.map((action) => {
    const actionType = String(action?.type || '').trim();
    if (actionType === 'add_to_list') {
      const targetListId = normalizeUuid(action.targetListId, 'list');
      if (!targetListId) throw Object.assign(new Error('A target list is required for the automation action'), { status: 400 });
      return { type: actionType, targetListId };
    }
    if (actionType === 'notify_email') {
      const toEmail = normalizeEmail(action.toEmail);
      if (!toEmail) throw Object.assign(new Error('A notification email is required for the automation action'), { status: 400 });
      return {
        type: actionType,
        toEmail,
        subject: String(action.subject || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 180) || 'Notifica Automation Studio',
        body: String(action.body || '').trim().slice(0, 3000),
      };
    }
    throw Object.assign(new Error('Invalid automation action'), { status: 400 });
  }) : [];
  if (!name) throw Object.assign(new Error('Automation name is required'), { status: 400 });
  if (triggerType === 'list_joined' && !triggerListId) {
    throw Object.assign(new Error('A list is required for the selected automation trigger'), { status: 400 });
  }
  if (!actions.length) throw Object.assign(new Error('At least one automation action is required'), { status: 400 });
  return {
    name,
    description: String(input.description || '').trim().slice(0, 500),
    active: input.active !== false,
    triggerType,
    triggerListId,
    triggerCondition,
    actions,
  };
}

function normalizeSequenceConditions(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 10) {
    throw Object.assign(new Error('Sequence trigger conditions must be an array with at most 10 items'), { status: 400 });
  }
  return value.map((condition) => {
    const field = String(condition?.field || '').trim();
    const operator = String(condition?.operator || '').trim();
    const operators = SEQUENCE_CONDITION_FIELDS.get(field);
    if (!operators || !operators.has(operator)) {
      throw Object.assign(new Error('Invalid sequence trigger condition'), { status: 400 });
    }
    if (operator === 'is_set' || operator === 'is_not_set') return { field, operator, value: null };
    let normalizedValue = String(condition?.value || '').trim();
    if (!normalizedValue) {
      throw Object.assign(new Error('A value is required for each sequence trigger condition'), { status: 400 });
    }
    if (field === 'contactType') normalizedValue = normalizeContactType(normalizedValue);
    if (field === 'contactStatusId') normalizedValue = normalizeContactStatusId(normalizedValue);
    if (field === 'emailStatus' && !EMAIL_STATUSES.has(normalizedValue)) {
      throw Object.assign(new Error('Invalid email status in sequence trigger condition'), { status: 400 });
    }
    if (field === 'webinarRegisteredAt') normalizedValue = normalizeWebinarDate(normalizedValue);
    if (field === 'tags') normalizedValue = normalizeTags([normalizedValue])[0];
    if (!normalizedValue) {
      throw Object.assign(new Error('A value is required for each sequence trigger condition'), { status: 400 });
    }
    return { field, operator, value: normalizedValue.slice(0, 255) };
  });
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
    contactType: query.contactType,
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
  normalizeListIds,
  normalizeTemplateAttachments,
  normalizeTemplateBuilderModel,
  normalizeTemplateBlockStyle,
  normalizeTemplateGlobalStyle,
  renderTemplateBuilderHtml,
  templateVariableCatalog,
  templateSlug,
  saveContact,
  sanitizeEmailHtml,
  validateTemplate,
  validateSequence,
  validateAutomation,
  normalizeSequenceConditions,
  normalizeBulkContactChanges,
  contactFiltersFromQuery,
};
