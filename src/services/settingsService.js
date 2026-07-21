const settingsRepo = require('../repos/settingsRepo');
const secretService = require('./secretService');

const TWILIO_KEYS = [
  'twilio_account_sid',
  'twilio_auth_token',
  'twilio_api_key_sid',
  'twilio_api_key_secret',
  'public_base_url',
];

let cachedTwilio = null;
let cacheExpiresAt = 0;

function decryptRow(row) {
  return row?.value_encrypted ? secretService.decrypt(row.value_encrypted) : '';
}

async function getTwilioSettings({ fresh = false } = {}) {
  if (!fresh && cachedTwilio && Date.now() < cacheExpiresAt) return cachedTwilio;
  const stored = await settingsRepo.getMany(TWILIO_KEYS);
  cachedTwilio = {
    accountSid: decryptRow(stored.twilio_account_sid) || process.env.TWILIO_ACCOUNT_SID || '',
    authToken: decryptRow(stored.twilio_auth_token) || process.env.TWILIO_AUTH_TOKEN || '',
    apiKeySid: decryptRow(stored.twilio_api_key_sid) || process.env.TWILIO_API_KEY_SID || '',
    apiKeySecret: decryptRow(stored.twilio_api_key_secret) || process.env.TWILIO_API_KEY_SECRET || '',
    publicBaseUrl: decryptRow(stored.public_base_url) || process.env.PUBLIC_BASE_URL || '',
    updatedAt: Object.values(stored).map((row) => row.updated_at).sort().at(-1) || null,
  };
  cacheExpiresAt = Date.now() + 30_000;
  return cachedTwilio;
}

function validateInput(input, current) {
  const merged = {
    accountSid: input.accountSid || current.accountSid,
    authToken: input.authToken || current.authToken,
    apiKeySid: input.apiKeySid || current.apiKeySid,
    apiKeySecret: input.apiKeySecret || current.apiKeySecret,
    publicBaseUrl: input.publicBaseUrl !== undefined ? input.publicBaseUrl : current.publicBaseUrl,
  };
  const errors = [];
  if (!/^AC[a-fA-F0-9]{32}$/.test(merged.accountSid)) errors.push('Account SID non valido (deve iniziare con AC)');
  if (!merged.authToken) errors.push('Auth Token obbligatorio per verificare i webhook');
  if (merged.apiKeySid && !/^SK[a-fA-F0-9]{32}$/.test(merged.apiKeySid)) errors.push('API Key SID non valido (deve iniziare con SK)');
  if (Boolean(merged.apiKeySid) !== Boolean(merged.apiKeySecret)) errors.push('API Key SID e API Secret devono essere configurati insieme');
  if (merged.publicBaseUrl) {
    try {
      const url = new URL(merged.publicBaseUrl);
      const local = ['localhost', '127.0.0.1'].includes(url.hostname);
      if (url.protocol !== 'https:' && !local) errors.push('L’URL pubblico deve usare HTTPS');
      merged.publicBaseUrl = url.toString().replace(/\/$/, '');
    } catch {
      errors.push('URL pubblico non valido');
    }
  }
  return { merged, errors };
}

async function saveTwilioSettings(input, updatedBy) {
  const current = await getTwilioSettings({ fresh: true });
  const { merged, errors } = validateInput(input, current);
  if (errors.length) {
    const error = new Error(errors.join('. '));
    error.status = 400;
    throw error;
  }

  const changed = {};
  const mapping = {
    accountSid: 'twilio_account_sid', authToken: 'twilio_auth_token',
    apiKeySid: 'twilio_api_key_sid', apiKeySecret: 'twilio_api_key_secret',
    publicBaseUrl: 'public_base_url',
  };
  for (const [field, key] of Object.entries(mapping)) {
    if (Object.hasOwn(input, field) && input[field] !== '') changed[key] = secretService.encrypt(merged[field]);
  }
  if (Object.hasOwn(input, 'publicBaseUrl') && input.publicBaseUrl === '') {
    changed.public_base_url = secretService.encrypt(' ');
  }
  if (!Object.keys(changed).length) throw Object.assign(new Error('Nessuna modifica da salvare'), { status: 400 });
  await settingsRepo.setMany(changed, updatedBy);
  cachedTwilio = null;
  cacheExpiresAt = 0;
  return getTwilioSettings({ fresh: true });
}

function mask(value, visible = 4) {
  if (!value) return '';
  return `${value.slice(0, visible)}${'•'.repeat(Math.min(12, Math.max(4, value.length - visible)))}`;
}

function publicTwilioSettings(settings) {
  return {
    accountSid: settings.accountSid,
    authTokenConfigured: Boolean(settings.authToken),
    authTokenMasked: mask(settings.authToken),
    apiKeySid: settings.apiKeySid,
    apiKeySecretConfigured: Boolean(settings.apiKeySecret),
    apiKeySecretMasked: mask(settings.apiKeySecret),
    publicBaseUrl: settings.publicBaseUrl.trim(),
    authenticationMode: settings.apiKeySid && settings.apiKeySecret ? 'api_key' : 'auth_token',
    updatedAt: settings.updatedAt,
  };
}

module.exports = { getTwilioSettings, saveTwilioSettings, publicTwilioSettings, validateInput };
