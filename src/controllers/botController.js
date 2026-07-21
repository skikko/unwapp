const botRepo = require('../repos/botRepo');
const secretService = require('../services/secretService');

function publicBot(bot) {
  if (!bot) return bot;
  const { ai_api_key_encrypted, ...safe } = bot;
  return { ...safe, api_key_configured: Boolean(ai_api_key_encrypted) };
}

function validate(body, { partial = false } = {}) {
  const errors = [];
  const required = ['name', 'slug', 'twilio_number'];
  if (!partial) {
    for (const k of required) {
      if (!body[k] || String(body[k]).trim() === '') errors.push(`${k} is required`);
    }
  }
  if (body.slug && !/^[a-z0-9-]+$/.test(body.slug)) {
    errors.push('slug must be lowercase letters, digits, hyphens');
  }
  if (body.provider && !['openai', 'gemini'].includes(body.provider)) {
    errors.push('provider must be openai or gemini');
  }
  if (body.temperature != null && (body.temperature < 0 || body.temperature > 2)) {
    errors.push('temperature must be between 0 and 2');
  }
  if (body.language && !['it', 'en', 'es', 'fr', 'de'].includes(body.language)) {
    errors.push('language must be one of it/en/es/fr/de');
  }
  return errors;
}

async function list(_req, res) {
  const bots = await botRepo.list();
  res.json({ bots: bots.map(publicBot) });
}

async function getOne(req, res) {
  const bot = await botRepo.getById(req.params.id);
  if (!bot) return res.status(404).json({ error: 'not found' });
  res.json({ bot: publicBot(bot) });
}

async function create(req, res) {
  const errors = validate(req.body);
  if (!req.body.ai_api_key) errors.push('ai_api_key is required');
  if (errors.length) return res.status(400).json({ errors });
  try {
    const input = { ...req.body, ai_api_key_encrypted: secretService.encrypt(req.body.ai_api_key) };
    if (input.provider === 'gemini') input.rag_enabled = false;
    delete input.ai_api_key;
    const bot = await botRepo.create(input);
    res.status(201).json({ bot: publicBot(bot) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'slug or twilio_number already exists' });
    }
    throw err;
  }
}

async function update(req, res) {
  const errors = validate(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ errors });
  try {
    const input = { ...req.body };
    if (input.provider === 'gemini') input.rag_enabled = false;
    if (input.ai_api_key) input.ai_api_key_encrypted = secretService.encrypt(input.ai_api_key);
    delete input.ai_api_key;
    const bot = await botRepo.update(req.params.id, input);
    if (!bot) return res.status(404).json({ error: 'not found' });
    res.json({ bot: publicBot(bot) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'slug or twilio_number already exists' });
    }
    throw err;
  }
}

async function remove(req, res) {
  await botRepo.remove(req.params.id);
  res.json({ success: true });
}

module.exports = { list, getOne, create, update, remove };
