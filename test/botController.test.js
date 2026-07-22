const test = require('node:test');
const assert = require('node:assert/strict');

const botRepo = require('../src/repos/botRepo');
const conversationRepo = require('../src/repos/conversationRepo');
const botController = require('../src/controllers/botController');

test('creates a manual-only BOT when no AI key is supplied', async (t) => {
  const originalCreate = botRepo.create;
  let savedInput;
  botRepo.create = async (input) => {
    savedInput = input;
    return { id: 'bot-1', ...input };
  };
  t.after(() => { botRepo.create = originalCreate; });

  const req = {
    body: {
      name: 'Operatori',
      slug: 'operatori',
      twilio_number: 'whatsapp:+14155238886',
      provider: 'openai',
      rag_enabled: true,
    },
  };
  let statusCode = 200;
  let payload;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };

  await botController.create(req, res);

  assert.equal(statusCode, 201);
  assert.equal(savedInput.ai_api_key_encrypted, null);
  assert.equal(savedInput.ai_enabled, false);
  assert.equal(savedInput.rag_enabled, false);
  assert.equal(payload.bot.api_key_configured, false);
  assert.equal(payload.bot.manual_only, true);
});

test('disables AI without deleting the saved API key or the BOT', async (t) => {
  const originalUpdate = botRepo.update;
  const originalSetManualByBot = conversationRepo.setManualByBot;
  let savedInput;
  let manualBotId;
  botRepo.update = async (id, input) => {
    savedInput = input;
    return {
      id,
      provider: 'openai',
      ai_api_key_encrypted: 'encrypted-key',
      ...input,
    };
  };
  conversationRepo.setManualByBot = async (botId) => {
    manualBotId = botId;
    return 2;
  };
  t.after(() => {
    botRepo.update = originalUpdate;
    conversationRepo.setManualByBot = originalSetManualByBot;
  });

  const events = [];
  const req = {
    params: { id: 'bot-1' },
    body: { ai_enabled: false },
    app: { get: () => ({ to: () => ({ emit: (...args) => events.push(args) }) }) },
  };
  let payload;
  const res = {
    status() { return this; },
    json(body) { payload = body; return this; },
  };

  await botController.update(req, res);

  assert.deepEqual(savedInput, { ai_enabled: false });
  assert.equal(manualBotId, 'bot-1');
  assert.equal(payload.bot.api_key_configured, true);
  assert.equal(payload.bot.ai_enabled, false);
  assert.equal(payload.bot.manual_only, true);
  assert.ok(events.some(([name, data]) => name === 'operator-mode-changed' && data.reason === 'ai_disabled'));
});
