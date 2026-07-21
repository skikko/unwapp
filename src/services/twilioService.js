const twilio = require('twilio');
const settingsService = require('./settingsService');

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

async function sendMessage(from, to, body) {
  const twilioClient = await client();
  return twilioClient.messages.create({
    from: addWhatsAppPrefix(from),
    to: addWhatsAppPrefix(to),
    body,
  });
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
  return contents.map((content) => {
    const approval = content.approvalRequests?.whatsapp || {};
    const type = content.types?.['twilio/text']
      || content.types?.['twilio/media']
      || content.types?.['whatsapp/card']
      || Object.values(content.types || {})[0]
      || {};
    return {
      sid: content.sid,
      name: content.friendlyName,
      language: content.language,
      status: approval.status || 'not_submitted',
      variables: content.variables || {},
      body: type.body || '',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
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
  addWhatsAppPrefix,
  stripWhatsAppPrefix,
  validateSignature,
  testConnection,
  resetClient,
};
