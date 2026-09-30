const crypto = require('crypto');
const path = require('path');
const mediaRepo = require('../repos/mediaRepo');
const settingsService = require('./settingsService');
const objectStorageService = require('./objectStorageService');

const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_STICKER_BYTES = 100 * 1024;
const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/3gpp',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/amr', 'audio/amr-nb', 'audio/ac3',
  'application/pdf', 'application/msword', 'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vcard', 'text/vcard', 'text/x-vcard',
]);

const EXTENSIONS = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/3gpp': '.3gp', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
  'audio/ogg': '.ogg', 'audio/amr': '.amr', 'audio/amr-nb': '.amr', 'audio/ac3': '.ac3',
  'application/pdf': '.pdf', 'application/msword': '.doc', 'application/vnd.ms-excel': '.xls',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vcard': '.vcf', 'text/vcard': '.vcf', 'text/x-vcard': '.vcf',
};

function sanitizeFilename(value, contentType = '') {
  const extension = EXTENSIONS[contentType] || '';
  const fallback = `allegato${extension}`;
  const original = path.basename(String(value || fallback), path.extname(String(value || fallback)));
  const stem = original.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'allegato';
  // Twilio requires a maximum of 20 ASCII characters, extension included.
  return `${stem.slice(0, Math.max(1, 20 - extension.length))}${extension}`;
}

function validateMedia({ buffer, size, mimetype }) {
  const byteSize = Number(size ?? buffer?.length ?? 0);
  const contentType = String(mimetype || '').toLowerCase().split(';')[0];
  if (!ALLOWED_TYPES.has(contentType)) {
    throw Object.assign(new Error(`Formato file non supportato: ${contentType || 'sconosciuto'}`), { status: 400 });
  }
  const maxBytes = contentType === 'image/webp' ? MAX_STICKER_BYTES
    : contentType.startsWith('image/') ? MAX_IMAGE_BYTES : MAX_MEDIA_BYTES;
  if (!byteSize || byteSize > maxBytes) {
    const maxLabel = maxBytes < 1024 * 1024 ? '100 KB' : `${maxBytes / (1024 * 1024)} MB`;
    throw Object.assign(new Error(`Il file ${contentType.startsWith('image/') ? 'immagine ' : ''}deve avere una dimensione massima di ${maxLabel}`), { status: 400 });
  }
  return { byteSize, contentType };
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function baseUrlFor(req) {
  const settings = await settingsService.getTwilioSettings();
  return settings.publicBaseUrl.trim().replace(/\/$/, '')
    || `${req.protocol}://${req.get('host')}`;
}

async function createAsset(file, { uploadedBy, purpose = 'chat', req } = {}) {
  const { byteSize, contentType } = validateMedia({
    buffer: file.buffer, size: file.size, mimetype: file.mimetype,
  });
  const filename = sanitizeFilename(file.originalname, contentType);
  const token = crypto.randomBytes(32).toString('base64url');
  const useObjectStorage = objectStorageService.validateConfiguration() === 's3';
  const storageKey = useObjectStorage ? objectStorageService.objectKey(token, filename) : null;
  if (storageKey) await objectStorageService.put(storageKey, file.buffer, contentType);
  let asset;
  try {
    asset = await mediaRepo.create({
      tokenHash: tokenHash(token), filename, contentType, byteSize,
      data: useObjectStorage ? null : file.buffer,
      storageProvider: useObjectStorage ? 's3' : 'database',
      storageKey,
      uploadedBy,
      purpose,
    });
  } catch (error) {
    if (storageKey) await objectStorageService.remove(storageKey).catch(() => {});
    throw error;
  }
  const baseUrl = await baseUrlFor(req);
  return {
    ...asset,
    url: `${baseUrl}/media/${token}/${encodeURIComponent(filename)}`,
  };
}

async function getAsset(token) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(String(token || ''))) return null;
  const asset = await mediaRepo.getByTokenHash(tokenHash(token));
  if (!asset) return null;
  if (asset.storage_provider === 's3') {
    if (!asset.storage_key) throw new Error('Media storage key is missing');
    asset.data = await objectStorageService.get(asset.storage_key);
  }
  return asset;
}

async function importFromTwilio(url, declaredType, { req, uploadedBy = 'twilio-webhook' } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('URL media Twilio non valido'); }
  if (parsed.protocol !== 'https:' || !(parsed.hostname === 'twilio.com' || parsed.hostname.endsWith('.twilio.com'))) {
    throw new Error('Host media Twilio non valido');
  }
  const settings = await settingsService.getTwilioSettings();
  const username = settings.apiKeySid && settings.apiKeySecret ? settings.apiKeySid : settings.accountSid;
  const password = settings.apiKeySid && settings.apiKeySecret ? settings.apiKeySecret : settings.authToken;
  const response = await fetch(parsed, {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
  });
  if (!response.ok) throw new Error(`Download media Twilio fallito (${response.status})`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_MEDIA_BYTES) throw new Error('Media Twilio oltre il limite di 16 MB');
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = String(response.headers.get('content-type') || declaredType || '').split(';')[0].toLowerCase();
  const extension = EXTENSIONS[contentType] || '';
  return createAsset({
    buffer,
    size: buffer.length,
    mimetype: contentType,
    originalname: `allegato-whatsapp${extension}`,
  }, { uploadedBy, purpose: 'incoming', req });
}

module.exports = {
  MAX_MEDIA_BYTES,
  MAX_IMAGE_BYTES,
  MAX_STICKER_BYTES,
  ALLOWED_TYPES,
  sanitizeFilename,
  validateMedia,
  createAsset,
  getAsset,
  importFromTwilio,
};
