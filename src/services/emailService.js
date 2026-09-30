const nodemailer = require('nodemailer');
const settingsRepo = require('../repos/settingsRepo');
const secretService = require('./secretService');
const crmRepo = require('../repos/crmRepo');

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
];

let cachedSettings = null;
let cacheExpiresAt = 0;
let workerRunning = false;
let workerTimer = null;
let workerPromise = null;
let stopping = false;
const emailClaimTimeoutMinutes = Math.max(1, Number(process.env.EMAIL_CLAIM_TIMEOUT_MINUTES || 30));

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

function renderTemplate(value, contact, { html = false } = {}) {
  const values = tokenValues(contact);
  return String(value || '').replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key) => {
    const replacement = values[key] ?? '';
    return html ? escapeHtml(replacement) : String(replacement);
  });
}

async function sendJob(job) {
  const settings = await getSettings();
  const { errors } = validateSettings({}, settings);
  if (errors.length) throw new Error(errors.join('. '));
  const info = await createTransport(settings).sendMail({
    from: settings.fromName ? { name: settings.fromName, address: settings.fromEmail } : settings.fromEmail,
    replyTo: settings.replyTo || undefined,
    to: job.email,
    subject: renderTemplate(job.subject, job),
    text: renderTemplate(job.text_body || '', job) || undefined,
    html: renderTemplate(job.html_body, job, { html: true }),
  });
  return info.messageId;
}

async function sendTestEmail(to, template) {
  const settings = await getSettings({ fresh: true });
  const { errors } = validateSettings({}, settings);
  if (errors.length) throw Object.assign(new Error(errors.join('. ')), { status: 409 });
  const contact = {
    first_name: 'Mario',
    last_name: 'Rossi',
    email: to,
    phone: '+393331234567',
    source: 'email-test',
    custom_fields: { city: 'Roma' },
  };
  const info = await createTransport(settings).sendMail({
    from: settings.fromName ? { name: settings.fromName, address: settings.fromEmail } : settings.fromEmail,
    replyTo: settings.replyTo || undefined,
    to,
    subject: `[TEST] ${renderTemplate(template.subject, contact)}`,
    text: renderTemplate(template.textBody || '', contact) || undefined,
    html: renderTemplate(template.htmlBody, contact, { html: true }),
  });
  return { messageId: info.messageId };
}

async function processDueJobs({ limit = 25 } = {}) {
  if (workerRunning) return { processed: 0 };
  workerRunning = true;
  let processed = 0;
  try {
    await crmRepo.recoverStaleEmailJobs(emailClaimTimeoutMinutes);
    await crmRepo.processSequenceTriggers();
    while (!stopping && processed < limit) {
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
  processDueJobs,
  startWorker,
  stopWorker,
};
