const twilio = require('twilio');
const settingsService = require('./settingsService');
const contentService = require('./contentService');

let _client = null;
let _clientFingerprint = '';
async function client() {
  const settings = await settingsService.getTwilioSettings();
  const fingerprint = [settings.accountSid, settings.apiKeySid, settings.apiKeySecret, settings.authToken].join(':');
  if (_client && _clientFingerprint === fingerprint) return _client;
  if (!settings.accountSid || !settings.authToken) {
    throw new Error('Configura Account SID e Auth Token nelle Impostazioni Twilio');
  }
  if (settings.apiKeySid && settings.apiKeySecret) {
    _client = twilio(settings.apiKeySid, settings.apiKeySecret, { accountSid: settings.accountSid });
  } else {
    _client = twilio(settings.accountSid, settings.authToken);
  }
  _clientFingerprint = fingerprint;
  return _client;
}

function resetClient() {
  _client = null;
  _clientFingerprint = '';
}

function addWhatsAppPrefix(n) {
  if (!n) return n;
  return n.startsWith('whatsapp:') ? n : `whatsapp:${n}`;
}

function stripWhatsAppPrefix(n) {
  return (n || '').replace(/^whatsapp:/, '');
}

async function sendMessage(from, to, body, { mediaUrl } = {}) {
  const twilioClient = await client();
  const payload = {
    from: addWhatsAppPrefix(from),
    to: addWhatsAppPrefix(to),
  };
  if (body) payload.body = body;
  if (mediaUrl) payload.mediaUrl = Array.isArray(mediaUrl) ? mediaUrl : [mediaUrl];
  if (!payload.body && !payload.mediaUrl) throw new Error('Messaggio o media obbligatorio');
  return twilioClient.messages.create(payload);
}

async function sendTemplate({ from, to, contentSid, contentVariables }) {
  const payload = {
    from: addWhatsAppPrefix(from),
    to: addWhatsAppPrefix(to),
    contentSid,
  };
  if (contentVariables && Object.keys(contentVariables).length) {
    payload.contentVariables = JSON.stringify(contentVariables);
  }
  const twilioClient = await client();
  return twilioClient.messages.create(payload);
}

async function listTemplates() {
  const twilioClient = await client();
  const contents = await twilioClient.content.v1.contentAndApprovals.list({ limit: 200 });
  return contents.map(normalizeContent).sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeContent(content, approvalOverride = null) {
  const approval = approvalOverride || content.approvalRequests?.whatsapp || {};
  const entries = Object.entries(content.types || {});
  const [contentType, definition = {}] = entries[0] || [];
  return {
    sid: content.sid,
    name: content.friendlyName,
    language: content.language,
    status: String(approval.status || 'not_submitted').toLowerCase(),
    category: approval.category || null,
    rejectionReason: approval.rejectionReason || approval.rejection_reason || null,
    variables: content.variables || {},
    type: contentType || 'unknown',
    body: definition.body || definition.title || '',
    media: definition.media || [],
    actions: definition.actions || [],
    footer: definition.footer || definition.subtitle || '',
  };
}

async function createTemplate(input) {
  const built = contentService.buildTemplatePayload(input);
  const twilioClient = await client();
  const content = await twilioClient.content.v1.contents.create(built.payload);
  let approval = null;
  let approvalError = null;
  if (input.submitForApproval !== false) {
    try {
      approval = await twilioClient.content.v1.contents(content.sid).approvalCreate.create({
        name: built.payload.friendly_name,
        category: built.category,
      });
    } catch (error) {
      approvalError = error.message;
    }
  }
  return {
    template: normalizeContent(content, approval),
    approvalError,
  };
}

async function createRichContent(input) {
  const built = contentService.buildRichMessagePayload(input);
  const twilioClient = await client();
  const content = await twilioClient.content.v1.contents.create(built.payload);
  return {
    sid: content.sid,
    type: built.type,
    actions: built.actions,
  };
}

async function validateSignature(req, url) {
  const sig = req.header('X-Twilio-Signature');
  const { authToken: token } = await settingsService.getTwilioSettings();
  if (!sig || !token) return false;
  return twilio.validateRequest(token, sig, url, req.body || {});
}

async function testConnection() {
  const twilioClient = await client();
  const contents = await twilioClient.content.v1.contents.list({ limit: 1 });
  const settings = await settingsService.getTwilioSettings();
  return { accountSid: settings.accountSid, contentApiReachable: true, templatesChecked: contents.length };
}

module.exports = {
  sendMessage,
  sendTemplate,
  listTemplates,
  createTemplate,
  createRichContent,
  addWhatsAppPrefix,
  stripWhatsAppPrefix,
  validateSignature,
  testConnection,
  resetClient,
};
