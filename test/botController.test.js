const test = require('node:test');
const assert = require('node:assert/strict');

const botRepo = require('../src/repos/botRepo');
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
  assert.equal(savedInput.rag_enabled, false);
  assert.equal(payload.bot.api_key_configured, false);
  assert.equal(payload.bot.manual_only, true);
});
