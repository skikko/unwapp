const crypto = require('crypto');
const nodemailer = require('nodemailer');
const settingsRepo = require('../repos/settingsRepo');
const secretService = require('./secretService');
const crmRepo = require('../repos/crmRepo');
const mediaService = require('./mediaService');
const crmService = require('./crmService');

const SMTP_KEYS = [
  'smtp_provider',
  'smtp_host',
  'smtp_port',
  'smtp_secure',
  'smtp_username',
  'smtp_password',
  'smtp_from_name',
  'smtp_from_email',
  'smtp_reply_to',
  'public_base_url',
];

let cachedSettings = null;
let cacheExpiresAt = 0;
let workerRunning = false;
let workerTimer = null;
let workerPromise = null;
let stopping = false;
const emailClaimTimeoutMinutes = Math.max(1, Number(process.env.EMAIL_CLAIM_TIMEOUT_MINUTES || 30));
const EMAIL_FOOTER = '© 2026 United Network | P.IVA: 13513131006 - PEC: uneuropa@pec.it';
const RECONTACT_LIST_NAME = process.env.CRM_RECONTACT_LIST_NAME || 'Da Ricontattare';
const RECONTACT_THANK_YOU_URL = process.env.CRM_RECONTACT_THANK_YOU_URL
  || 'https://www.unitednetwork.it/grazie-ricontatto/';

function decrypt(row) {
  return row?.value_encrypted ? secretService.decrypt(row.value_encrypted).trim() : '';
}

async function getSettings({ fresh = false } = {}) {
  if (!fresh && cachedSettings && Date.now() < cacheExpiresAt) return cachedSettings;
  const stored = await settingsRepo.getMany(SMTP_KEYS);
  const provider = decrypt(stored.smtp_provider) || process.env.SMTP_PROVIDER || 'smtp';
  cachedSettings = {
    provider,
    host: decrypt(stored.smtp_host) || process.env.SMTP_HOST || (provider === 'gmail' ? 'smtp.gmail.com' : ''),
    port: Number(decrypt(stored.smtp_port) || process.env.SMTP_PORT || (provider === 'gmail' ? 465 : 587)),
    secure: (decrypt(stored.smtp_secure) || process.env.SMTP_SECURE || (provider === 'gmail' ? 'true' : 'false')) === 'true',
    username: decrypt(stored.smtp_username) || process.env.SMTP_USERNAME || '',
    password: decrypt(stored.smtp_password) || process.env.SMTP_PASSWORD || '',
    fromName: decrypt(stored.smtp_from_name) || process.env.SMTP_FROM_NAME || '',
    fromEmail: decrypt(stored.smtp_from_email) || process.env.SMTP_FROM_EMAIL || '',
    replyTo: decrypt(stored.smtp_reply_to) || process.env.SMTP_REPLY_TO || '',
    publicBaseUrl: (decrypt(stored.public_base_url) || process.env.PUBLIC_BASE_URL
      || 'https://un-whatsapp-manager-4jwa.onrender.com').replace(/\/+$/, ''),
    updatedAt: Object.values(stored).map((row) => row.updated_at).filter(Boolean).sort().at(-1) || null,
  };
  cacheExpiresAt = Date.now() + 30_000;
  return cachedSettings;
}

function validateSettings(input, current = {}) {
  const provider = input.provider || current.provider || 'smtp';
  const defaults = provider === 'gmail'
    ? { host: 'smtp.gmail.com', port: 465, secure: true }
    : { host: '', port: 587, secure: false };
  const merged = {
    provider,
    host: input.host || current.host || defaults.host,
    port: Number(input.port || current.port || defaults.port),
    secure: input.secure === undefined ? Boolean(current.secure ?? defaults.secure) : Boolean(input.secure),
    username: input.username || current.username || '',
    password: input.password || current.password || '',
    fromName: input.fromName === undefined ? current.fromName || '' : String(input.fromName).trim(),
    fromEmail: input.fromEmail === undefined ? current.fromEmail || '' : String(input.fromEmail).trim().toLowerCase(),
    replyTo: input.replyTo === undefined ? current.replyTo || '' : String(input.replyTo).trim().toLowerCase(),
  };
  const errors = [];
  if (!['gmail', 'smtp'].includes(merged.provider)) errors.push('Unsupported SMTP provider');
  if (!merged.host) errors.push('SMTP host is required');
  if (!Number.isInteger(merged.port) || merged.port < 1 || merged.port > 65535) errors.push('Invalid SMTP port');
  if (!merged.username) errors.push('SMTP username is required');
  if (!merged.password) errors.push('SMTP password is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(merged.fromEmail)) errors.push('Invalid sender email address');
  if (merged.replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(merged.replyTo)) errors.push('Invalid reply-to address');
  return { merged, errors };
}

async function saveSettings(input, updatedBy) {
  const current = await getSettings({ fresh: true });
  const { merged, errors } = validateSettings(input, current);
  if (errors.length) throw Object.assign(new Error(errors.join('. ')), { status: 400 });
  const values = {
    smtp_provider: merged.provider,
    smtp_host: merged.host,
    smtp_port: String(merged.port),
    smtp_secure: String(merged.secure),
    smtp_username: merged.username,
    smtp_from_name: merged.fromName,
    smtp_from_email: merged.fromEmail,
    smtp_reply_to: merged.replyTo || ' ',
  };
  if (input.password) values.smtp_password = merged.password;
  const encrypted = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, secretService.encrypt(value)]));
  await settingsRepo.setMany(encrypted, updatedBy);
  cachedSettings = null;
  cacheExpiresAt = 0;
  return getSettings({ fresh: true });
}

function publicSettings(settings) {
  return {
    provider: settings.provider,
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    username: settings.username,
    passwordConfigured: Boolean(settings.password),
    passwordMasked: settings.password ? `${settings.password.slice(0, 2)}********` : '',
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo,
    publicBaseUrl: settings.publicBaseUrl,
    updatedAt: settings.updatedAt,
  };
}

function createTransport(settings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.username, pass: settings.password },
  });
}

async function testConnection() {
  const settings = await getSettings({ fresh: true });
  const { errors } = validateSettings({}, settings);
  if (errors.length) throw new Error(errors.join('. '));
  await createTransport(settings).verify();
  return { host: settings.host, port: settings.port, secure: settings.secure };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function tokenValues(contact) {
  return {
    first_name: contact.first_name || '',
    last_name: contact.last_name || '',
    full_name: [contact.first_name, contact.last_name].filter(Boolean).join(' '),
    email: contact.email || '',
    phone: contact.phone || '',
    source: contact.source || '',
    ...(contact.custom_fields || {}),
  };
}

function renderTemplate(value, contact, { html = false, variables = {} } = {}) {
  const values = { ...tokenValues(contact), ...variables };
  return String(value || '').replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key) => {
    const replacement = values[key] ?? '';
    return html ? escapeHtml(replacement) : String(replacement);
  });
}

function recontactToken(jobId) {
  const normalizedJobId = String(jobId || '').trim();
  if (!normalizedJobId) throw new Error('Email job id is required');
  const payload = encodeTrackingUrl(JSON.stringify({ jid: normalizedJobId }));
  return `${payload}.${signEmailTracking(normalizedJobId, 'recontact')}`;
}

function recontactTestToken(email, context = null) {
  const normalizedEmail = normalizeEmailForToken(email);
  if (!normalizedEmail) throw new Error('Test recipient email is required');
  const payload = encodeTrackingUrl(JSON.stringify({ email: normalizedEmail, ...(context ? { context } : {}) }));
  const identity = context ? `${normalizedEmail}:${context}` : normalizedEmail;
  return `${payload}.${signEmailTracking(identity, 'recontact_test')}`;
}

function verifyRecontactTokenPayload(token) {
  const [payloadToken, signature, extra] = String(token || '').trim().split('.');
  if (!payloadToken || !/^[a-f0-9]{64}$/.test(signature || '') || extra !== undefined) {
    throw Object.assign(new Error('Invalid recontact token'), { status: 400 });
  }
  let payload;
  try {
    payload = JSON.parse(decodeTrackingUrl(payloadToken));
  } catch {
    throw Object.assign(new Error('Invalid recontact token'), { status: 400 });
  }
  const jobId = String(payload?.jid || '').trim();
  if (jobId) {
    if (!verifyEmailTracking({ jobId, eventType: 'recontact', sig: signature })) {
      throw Object.assign(new Error('Invalid recontact token'), { status: 400 });
    }
    return { type: 'job', jobId };
  }
  const email = normalizeEmailForToken(payload?.email);
  if (email) {
    const context = payload.context || null;
    const identity = context ? `${email}:${context}` : email;
    if (!verifyEmailTracking({ jobId: identity, eventType: 'recontact_test', sig: signature })) {
      throw Object.assign(new Error('Invalid recontact token'), { status: 400 });
    }
    return { type: 'email', email, context };
  }
  throw Object.assign(new Error('Invalid recontact token'), { status: 400 });
}

function verifyRecontactToken(token) {
  const payload = verifyRecontactTokenPayload(token);
  if (payload.type !== 'job') {
    throw Object.assign(new Error('Invalid recontact token'), { status: 400 });
  }
  return payload.jobId;
}

function recontactThankYouUrl(jobId = null, options = {}) {
  const url = new URL(RECONTACT_THANK_YOU_URL);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid recontact thank you URL');
  if (jobId) url.searchParams.set('token', recontactToken(jobId));
  else if (options.email) url.searchParams.set('token', recontactTestToken(options.email, options.context));
  return url.toString();
}

function recontactActionUrl(jobId) {
  return recontactThankYouUrl(jobId);
}

function unsubscribeSecret() {
  return process.env.CRM_UNSUBSCRIBE_SECRET || process.env.APP_ENCRYPTION_KEY || '';
}

function trackingSecret() {
  return process.env.CRM_TRACKING_SECRET || unsubscribeSecret();
}

function normalizeEmailForToken(value) {
  return String(value || '').trim().toLowerCase();
}

function signUnsubscribe(contactId, email) {
  const secret = unsubscribeSecret();
  if (!secret || secret.length < 32) {
    throw new Error('CRM_UNSUBSCRIBE_SECRET or APP_ENCRYPTION_KEY must be configured');
  }
  return crypto
    .createHmac('sha256', secret)
    .update(`${contactId}:${normalizeEmailForToken(email)}`)
    .digest('hex');
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signEmailTracking(jobId, eventType, url = '') {
  const secret = trackingSecret();
  if (!secret || secret.length < 32) {
    throw new Error('CRM_TRACKING_SECRET, CRM_UNSUBSCRIBE_SECRET or APP_ENCRYPTION_KEY must be configured');
  }
  return crypto
    .createHmac('sha256', secret)
    .update(`${jobId}:${eventType}:${url}`)
    .digest('hex');
}

function verifyEmailTracking({ jobId, eventType, url = '', sig } = {}) {
  if (!jobId || !eventType || !sig) return false;
  return timingSafeEqual(signEmailTracking(jobId, eventType, url), sig);
}

function encodeTrackingUrl(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}

function decodeTrackingUrl(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function unsubscribeUrl(contact, baseUrl) {
  const contactId = contact.contact_id || contact.id;
  const email = normalizeEmailForToken(contact.email_normalized || contact.email);
  if (!contactId || !email) return null;
  const signature = signUnsubscribe(contactId, email);
  const url = new URL('/unsubscribe', baseUrl);
  url.searchParams.set('cid', contactId);
  url.searchParams.set('email', email);
  url.searchParams.set('sig', signature);
  return url.toString();
}

function appendComplianceFooter(html, contact, baseUrl) {
  const url = unsubscribeUrl(contact, baseUrl);
  const unsubscribeLink = url
    ? `<a href="${escapeHtml(url)}" style="color:#5b6270;text-decoration:underline;">Disiscriviti</a>`
    : 'Disiscriviti';
  const footer = `<div style="max-width:640px;margin:28px auto 0;padding-top:16px;border-top:1px solid #d6d6d6;color:#5b6270;font-family:Arial, sans-serif;font-size:12px;line-height:1.5;">${escapeHtml(EMAIL_FOOTER)}<br>${unsubscribeLink}</div>`;
  const responsiveStyles = '<style>@media only screen and (max-width:640px){.email-hide-mobile{display:none!important;max-height:0!important;overflow:hidden!important}}</style>';
  let content = String(html || '');
  if (/<\/head>/i.test(content)) {
    content = content.replace(/<\/head>/i, `${responsiveStyles}</head>`);
  } else {
    content = `${responsiveStyles}${content}`;
  }
  if (/<\/body>/i.test(content)) return content.replace(/<\/body>/i, `${footer}</body>`);
  return `${content}${footer}`;
}

function appendComplianceFooterText(text, contact, baseUrl) {
  const url = unsubscribeUrl(contact, baseUrl);
  const lines = ['', EMAIL_FOOTER];
  if (url) lines.push(`Disiscriviti: ${url}`);
  return `${String(text || '').trim()}${lines.join('\n')}`;
}

function shouldTrackHref(href, baseUrl) {
  if (!href) return false;
  const normalized = String(href).trim();
  if (!normalized || normalized.startsWith('#')) return false;
  try {
    const url = new URL(normalized, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (url.pathname === '/unsubscribe') return false;
    if (url.pathname === '/email/click' || url.pathname === '/email/open.gif' || url.pathname === '/email/recontact') return false;
    return true;
  } catch {
    return false;
  }
}

function trackedClickUrl(jobId, href, baseUrl) {
  const targetUrl = new URL(String(href).trim(), baseUrl).toString();
  const trackingUrl = new URL('/email/click', baseUrl);
  trackingUrl.searchParams.set('jid', jobId);
  trackingUrl.searchParams.set('u', encodeTrackingUrl(targetUrl));
  trackingUrl.searchParams.set('sig', signEmailTracking(jobId, 'click', targetUrl));
  return trackingUrl.toString();
}

function applyEmailTracking(html, job, baseUrl) {
  const jobId = job?.id;
  if (!jobId) return String(html || '');
  const rendered = String(html || '').replace(
    /\s(href)=("([^"]*)"|'([^']*)')/gi,
    (match, attribute, quoted, doubleHref, singleHref) => {
      const href = doubleHref ?? singleHref ?? '';
      if (!shouldTrackHref(href, baseUrl)) return match;
      const quote = quoted.startsWith("'") ? "'" : '"';
      return ` ${attribute}=${quote}${escapeHtml(trackedClickUrl(jobId, href, baseUrl))}${quote}`;
    }
  );
  const openUrl = new URL('/email/open.gif', baseUrl);
  openUrl.searchParams.set('jid', jobId);
  openUrl.searchParams.set('sig', signEmailTracking(jobId, 'open'));
  const pixel = `<img src="${escapeHtml(openUrl.toString())}" width="1" height="1" alt="" style="display:none!important;width:1px;height:1px;opacity:0;border:0;">`;
  if (/<\/body>/i.test(rendered)) return rendered.replace(/<\/body>/i, `${pixel}</body>`);
  return `${rendered}${pixel}`;
}

async function trackEmailOpen(input = {}) {
  if (!verifyEmailTracking({ jobId: input.jobId, eventType: 'open', sig: input.sig })) return false;
  await crmRepo.recordEmailEvent({
    jobId: input.jobId,
    eventType: 'open',
    userAgent: input.userAgent,
    ip: input.ip,
  });
  return true;
}

async function trackEmailClick(input = {}) {
  let target;
  try {
    target = new URL(decodeTrackingUrl(input.urlToken));
  } catch {
    throw Object.assign(new Error('Invalid redirect URL'), { status: 400 });
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw Object.assign(new Error('Invalid redirect URL'), { status: 400 });
  }
  if (!verifyEmailTracking({
    jobId: input.jobId,
    eventType: 'click',
    url: target.toString(),
    sig: input.sig,
  })) {
    throw Object.assign(new Error('Invalid tracking signature'), { status: 400 });
  }
  await crmRepo.recordEmailEvent({
    jobId: input.jobId,
    eventType: 'click',
    url: target.toString(),
    userAgent: input.userAgent,
    ip: input.ip,
  });
  return target.toString();
}

async function requestRecontact(input = {}) {
  if (!verifyEmailTracking({
    jobId: input.jobId,
    eventType: 'recontact',
    sig: input.sig,
  })) {
    throw Object.assign(new Error('Invalid recontact signature'), { status: 400 });
  }
  return recontactThankYouUrl(input.jobId);
}

async function confirmRecontact(input = {}) {
  const payload = verifyRecontactTokenPayload(input.token);
  const profile = await getRecontactProfile(input);
  const phone = crmService.normalizePhone(input.phone);
  if (profile.isLastCall && !profile.contact.phone && !phone) {
    return { success: false, requiresPhone: true, contact: profile.contact };
  }
  if (payload.type === 'email') {
    const event = await crmRepo.recordEmailTestRecontact({
      email: payload.email,
      userAgent: input.userAgent,
      ip: input.ip,
      listName: RECONTACT_LIST_NAME,
      phone,
      tags: profile.isLastCall ? ['lastcall'] : [],
    });
    return { success: true, membershipAdded: event.membershipAdded };
  }
  const event = await crmRepo.recordEmailEvent({
    jobId: payload.jobId,
    eventType: 'click',
    url: '/api/public/recontact-request',
    userAgent: input.userAgent,
    ip: input.ip,
    listName: RECONTACT_LIST_NAME,
    phone,
    tags: profile.isLastCall ? ['lastcall'] : [],
  });
  if (!event) throw Object.assign(new Error('Email job not found'), { status: 404 });
  return { success: true, membershipAdded: event.membershipAdded };
}

async function getRecontactProfile(input = {}) {
  const payload = verifyRecontactTokenPayload(input.token);
  const contact = await crmRepo.getRecontactContact(payload);
  if (!contact && payload.type === 'job') {
    throw Object.assign(new Error('Email job not found'), { status: 404 });
  }
  const isLastCall = payload.context === 'lastcall' || (contact?.template_tags || []).includes('lastcall');
  return {
    contact: {
      firstName: contact?.first_name || '',
      lastName: contact?.last_name || '',
      email: contact?.email || payload.email || '',
      phone: contact?.phone || '',
    },
    requiresPhone: !contact?.phone,
    isLastCall,
  };
}

async function unsubscribeContact({ cid, email, sig } = {}) {
  const contactId = String(cid || '').trim();
  const emailNormalized = normalizeEmailForToken(email);
  const signature = String(sig || '').trim();
  if (!contactId || !emailNormalized || !signature) {
    throw Object.assign(new Error('Unsubscribe link is invalid'), { status: 400 });
  }
  const expected = signUnsubscribe(contactId, emailNormalized);
  if (!timingSafeEqual(expected, signature)) {
    throw Object.assign(new Error('Unsubscribe link is invalid'), { status: 400 });
  }
  const contact = await crmRepo.unsubscribeContact(contactId, emailNormalized);
  if (!contact) throw Object.assign(new Error('Contact not found'), { status: 404 });
  return contact;
}

async function inlineStoredMedia(html) {
  let renderedHtml = String(html || '');
  const mediaPattern = /(?:https?:\/\/[^"'<>\s]+)?\/media\/([A-Za-z0-9_-]{40,60})(?:\/[^"'<>\s]*)?/g;
  const matches = [...renderedHtml.matchAll(mediaPattern)];
  const attachments = [];
  const processedTokens = new Set();

  for (const match of matches) {
    const [url, token] = match;
    if (processedTokens.has(token)) continue;
    processedTokens.add(token);
    const asset = await mediaService.getAsset(token);
    if (!asset || !String(asset.content_type || '').startsWith('image/') || !asset.data) continue;
    const cid = `crm-${token.slice(0, 16)}@un-platform`;
    renderedHtml = renderedHtml.split(url).join(`cid:${cid}`);
    attachments.push({
      filename: asset.filename,
      content: asset.data,
      contentType: asset.content_type,
      cid,
    });
  }

  return { html: renderedHtml, attachments };
}

async function storedTemplateAttachments(attachments = []) {
  if (!Array.isArray(attachments) || !attachments.length) return [];
  const mediaPattern = /(?:https?:\/\/[^"'<>\s]+)?\/media\/([A-Za-z0-9_-]{40,60})(?:\/[^"'<>\s]*)?/;
  const processedTokens = new Set();
  const files = [];
  for (const attachment of attachments) {
    const token = String(attachment?.url || '').match(mediaPattern)?.[1];
    if (!token || processedTokens.has(token)) continue;
    processedTokens.add(token);
    const asset = await mediaService.getAsset(token);
    if (!asset || !asset.data) continue;
    files.push({
      filename: asset.filename,
      content: asset.data,
      contentType: asset.content_type,
    });
  }
  return files;
}

async function sendJob(job) {
  const settings = await getSettings();
  const { errors } = validateSettings({}, settings);
  if (errors.length) throw new Error(errors.join('. '));
  const variables = { recontact_url: recontactActionUrl(job.id, settings.publicBaseUrl) };
  const html = appendComplianceFooter(renderTemplate(job.html_body, job, { html: true, variables }), job, settings.publicBaseUrl);
  const text = appendComplianceFooterText(renderTemplate(job.text_body || '', job, { variables }), job, settings.publicBaseUrl);
  const trackedHtml = applyEmailTracking(html, job, settings.publicBaseUrl);
  const attachments = await storedTemplateAttachments(job.attachments);
  const info = await createTransport(settings).sendMail({
    from: settings.fromName ? { name: settings.fromName, address: settings.fromEmail } : settings.fromEmail,
    replyTo: settings.replyTo || undefined,
    to: job.email,
    subject: renderTemplate(job.subject, job),
    text: text || undefined,
    html: trackedHtml,
    attachments,
  });
  return info.messageId;
}

async function sendTestEmail(to, template) {
  const settings = await getSettings({ fresh: true });
  const { errors } = validateSettings({}, settings);
  if (errors.length) throw Object.assign(new Error(errors.join('. ')), { status: 409 });
  const contact = {
    contact_id: '00000000-0000-4000-8000-000000000000',
    first_name: 'Mario',
    last_name: 'Rossi',
    email: to,
    email_normalized: to,
    phone: '+393331234567',
    source: 'email-test',
    custom_fields: { city: 'Roma' },
  };
  const variables = { recontact_url: recontactThankYouUrl(null, {
    email: to,
    context: (template.tags || []).includes('lastcall') ? 'lastcall' : null,
  }) };
  const html = appendComplianceFooter(renderTemplate(template.htmlBody, contact, { html: true, variables }), contact, settings.publicBaseUrl);
  const text = appendComplianceFooterText(renderTemplate(template.textBody || '', contact, { variables }), contact, settings.publicBaseUrl);
  const attachments = await storedTemplateAttachments(template.attachments);
  const info = await createTransport(settings).sendMail({
    from: settings.fromName ? { name: settings.fromName, address: settings.fromEmail } : settings.fromEmail,
    replyTo: settings.replyTo || undefined,
    to,
    subject: `[TEST] ${renderTemplate(template.subject, contact)}`,
    text: text || undefined,
    html,
    attachments,
  });
  return { messageId: info.messageId };
}

async function sendAutomationNotification(notification) {
  const settings = await getSettings();
  const { errors } = validateSettings({}, settings);
  if (errors.length) throw new Error(errors.join('. '));
  const text = String(notification.body || '').trim();
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#171a23;white-space:pre-line;">${escapeHtml(text)}</div>`;
  const info = await createTransport(settings).sendMail({
    from: settings.fromName ? { name: settings.fromName, address: settings.fromEmail } : settings.fromEmail,
    replyTo: settings.replyTo || undefined,
    to: notification.to_email,
    subject: notification.subject,
    text,
    html,
  });
  return info.messageId;
}

async function processDueJobs({ limit = 25 } = {}) {
  if (workerRunning) return { processed: 0 };
  workerRunning = true;
  let processed = 0;
  try {
    await crmRepo.recoverStaleEmailJobs(emailClaimTimeoutMinutes);
    await crmRepo.processSequenceTriggers();
    while (!stopping && processed < limit) {
      const notification = await crmRepo.claimDueAutomationNotification();
      if (notification) {
        try {
          const messageId = await sendAutomationNotification(notification);
          await crmRepo.markAutomationNotificationSent(notification, messageId);
        } catch (error) {
          await crmRepo.markAutomationNotificationFailed(notification, String(error.message || error).slice(0, 1000));
        }
        processed += 1;
        continue;
      }
      const job = await crmRepo.claimDueJob();
      if (!job) break;
      try {
        const messageId = await sendJob(job);
        await crmRepo.markJobSent(job, messageId);
      } catch (error) {
        await crmRepo.markJobFailed(job, String(error.message || error).slice(0, 1000));
      }
      processed += 1;
    }
    return { processed };
  } finally {
    workerRunning = false;
  }
}

function startWorker() {
  if (workerTimer) return workerTimer;
  stopping = false;

  const runCycle = () => {
    if (workerPromise) return;
    workerPromise = processDueJobs()
      .catch((error) => console.error('Email worker error:', error.message))
      .finally(() => { workerPromise = null; });
  };

  workerTimer = setInterval(runCycle, 10_000);
  workerTimer.unref();
  runCycle();
  return workerTimer;
}

async function stopWorker() {
  stopping = true;
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  if (workerPromise) await workerPromise;
}

module.exports = {
  getSettings,
  validateSettings,
  saveSettings,
  publicSettings,
  testConnection,
  sendTestEmail,
  renderTemplate,
  appendComplianceFooter,
  appendComplianceFooterText,
  signUnsubscribe,
  unsubscribeContact,
  signEmailTracking,
  verifyEmailTracking,
  encodeTrackingUrl,
  decodeTrackingUrl,
  recontactToken,
  verifyRecontactToken,
  recontactThankYouUrl,
  applyEmailTracking,
  trackEmailOpen,
  trackEmailClick,
  requestRecontact,
  confirmRecontact,
  getRecontactProfile,
  inlineStoredMedia,
  storedTemplateAttachments,
  sendAutomationNotification,
  processDueJobs,
  startWorker,
  stopWorker,
};
