const TEMPLATE_TYPES = new Set(['text', 'media', 'call_to_action', 'quick_reply', 'card']);
const CATEGORIES = new Set(['UTILITY', 'MARKETING']);
const ACTION_TYPES = new Set(['URL', 'PHONE_NUMBER', 'QUICK_REPLY']);

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

function requirePublicHttpsUrl(value, label = 'URL') {
  const raw = String(value || '').trim();
  let url;
  try { url = new URL(raw.replace(/{{\s*\d+\s*}}/g, 'sample')); } catch { invalid(`${label} non valido`); }
  if (url.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) {
    invalid(`${label} deve essere un indirizzo HTTPS pubblico`);
  }
  return raw;
}

function variableKeys(...values) {
  const keys = new Set();
  for (const value of values.flat(Infinity)) {
    const text = String(value || '');
    for (const match of text.matchAll(/{{\s*(\d+)\s*}}/g)) keys.add(match[1]);
  }
  return [...keys].sort((a, b) => Number(a) - Number(b));
}

function normalizeVariables(samples, keys) {
  const source = samples && typeof samples === 'object' ? samples : {};
  const variables = {};
  for (const key of keys) {
    const value = String(source[key] || '').trim();
    if (!value) invalid(`Inserisci un esempio per la variabile {{${key}}}`);
    variables[key] = value;
  }
  return variables;
}

function actionId(title, index) {
  const slug = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return (slug || `azione_${index + 1}`).slice(0, 128);
}

function normalizeActions(actions, { max = 3, allowed = ACTION_TYPES } = {}) {
  const source = Array.isArray(actions) ? actions : [];
  if (source.length > max) invalid(`Sono consentite al massimo ${max} azioni`);
  return source.map((action, index) => {
    const type = String(action?.type || '').toUpperCase();
    const title = String(action?.title || '').trim();
    if (!allowed.has(type)) invalid('Tipo di azione non supportato');
    if (!title || title.length > 25) invalid('Il titolo di ogni pulsante deve contenere da 1 a 25 caratteri');
    if (/{{\s*\d+\s*}}/.test(title)) invalid('Il titolo dei pulsanti non può contenere variabili');
    if (type === 'URL') {
      return { type, title, url: requirePublicHttpsUrl(action.url, 'URL del pulsante') };
    }
    if (type === 'PHONE_NUMBER') {
      const phone = String(action.phone || '').replace(/\s+/g, '');
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) invalid('Il telefono della CTA deve essere in formato internazionale E.164');
      return { type, title, phone };
    }
    return { type, title, id: String(action.id || actionId(title, index)).slice(0, 128) };
  });
}

function buildTemplatePayload(input) {
  const friendlyName = String(input.friendlyName || '').trim().toLowerCase();
  const language = String(input.language || 'it').trim();
  const category = String(input.category || 'UTILITY').toUpperCase();
  const type = String(input.type || 'text');
  const body = String(input.body || '').trim();
  const mediaUrl = input.mediaUrl ? requirePublicHttpsUrl(input.mediaUrl, 'URL del media') : '';
  const footer = String(input.footer || '').trim();
  const headerText = String(input.headerText || '').trim();

  if (!/^[a-z0-9_]{1,512}$/.test(friendlyName)) {
    invalid('Il nome template deve usare solo lettere minuscole, numeri e underscore');
  }
  if (!/^[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/.test(language)) invalid('Lingua template non valida');
  if (!CATEGORIES.has(category)) invalid('Categoria template non valida');
  if (!TEMPLATE_TYPES.has(type)) invalid('Tipo template non supportato');
  if (!body) invalid('Il testo del template è obbligatorio');
  const bodyLimit = type === 'call_to_action' ? 640 : type === 'card' || type === 'quick_reply' ? 1024 : 1600;
  if (body.length > bodyLimit) invalid(`Il testo del template supera ${bodyLimit.toLocaleString('it-IT')} caratteri`);
  if (headerText.length > 60) invalid('L’header del template supera 60 caratteri');
  if (footer.length > 60) invalid('Il footer del template supera 60 caratteri');
  if (type === 'card' && mediaUrl && headerText) invalid('Una card WhatsApp non può avere sia un media sia un header testuale');

  let actions = [];
  let types;
  if (type === 'text') {
    types = { 'twilio/text': { body } };
  } else if (type === 'media') {
    if (!mediaUrl) invalid('Carica un file o inserisci un URL media');
    types = { 'twilio/media': { body, media: [mediaUrl] } };
  } else if (type === 'call_to_action') {
    actions = normalizeActions(input.actions, {
      max: 2,
      allowed: new Set(['URL', 'PHONE_NUMBER']),
    });
    if (!actions.length) invalid('Aggiungi almeno una CTA');
    types = { 'twilio/call-to-action': { body, actions } };
  } else if (type === 'quick_reply') {
    actions = normalizeActions(input.actions, {
      max: 3,
      allowed: new Set(['QUICK_REPLY']),
    });
    if (!actions.length) invalid('Aggiungi almeno una risposta rapida');
    types = { 'twilio/quick-reply': { body, actions } };
  } else {
    actions = normalizeActions(input.actions, { max: 3 });
    if (!mediaUrl && !actions.length && !footer && !headerText) {
      invalid('Il contenuto avanzato richiede un media, un pulsante, un header o un footer');
    }
    types = {
      'whatsapp/card': {
        body,
        ...(mediaUrl ? { media: [mediaUrl] } : {}),
        ...(headerText ? { header_text: headerText } : {}),
        ...(footer ? { footer } : {}),
        ...(actions.length ? { actions } : {}),
      },
    };
  }

  const keys = variableKeys(body, mediaUrl, footer, headerText, actions.map((action) => action.url));
  const variables = normalizeVariables(input.variables, keys);
  return {
    category,
    type,
    actions,
    variableKeys: keys,
    payload: {
      friendly_name: friendlyName,
      language,
      variables,
      types,
    },
  };
}

function buildRichMessagePayload(input) {
  const body = String(input.body || '').trim();
  const mediaUrl = input.mediaUrl ? requirePublicHttpsUrl(input.mediaUrl, 'URL del media') : '';
  const actions = normalizeActions(input.actions, { max: 3 });
  if (!body && !mediaUrl) invalid('Inserisci un messaggio o allega un file');
  if (actions.length && !body) invalid('Il testo è obbligatorio quando aggiungi pulsanti');
  if (actions.some((action) => action.type === 'PHONE_NUMBER')) {
    invalid('Nella chat operatore usa un pulsante URL o una risposta rapida; la CTA telefonica richiede un template approvato');
  }
  if (new Set(actions.map((action) => action.type)).size > 1) {
    invalid('In una chat WhatsApp i pulsanti non approvati devono essere tutti dello stesso tipo');
  }
  if (actions.filter((action) => action.type === 'URL').length > 1) {
    invalid('In una chat WhatsApp è consentito un solo pulsante URL');
  }

  let type = 'text';
  if (mediaUrl && actions.length) type = 'card';
  else if (mediaUrl) type = 'media';
  else if (actions.every((action) => action.type === 'QUICK_REPLY')) type = 'quick_reply';
  else if (actions.length && actions.length <= 2 && actions.every((action) => action.type !== 'QUICK_REPLY')) type = 'call_to_action';
  else if (actions.length) type = 'card';

  return buildTemplatePayload({
    friendlyName: input.friendlyName,
    language: input.language || 'it',
    category: 'UTILITY',
    type,
    body: body || 'Allegato',
    mediaUrl,
    actions,
    variables: {},
  });
}

module.exports = {
  buildTemplatePayload,
  buildRichMessagePayload,
  normalizeActions,
  variableKeys,
  requirePublicHttpsUrl,
};
