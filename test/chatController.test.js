const test = require('node:test');
const assert = require('node:assert/strict');

const botRepo = require('../src/repos/botRepo');
const conversationRepo = require('../src/repos/conversationRepo');
const chatController = require('../src/controllers/chatController');

test('does not release a conversation to a BOT whose AI replies are disabled', async (t) => {
  const originals = {
    getConversation: conversationRepo.getById,
    getBot: botRepo.getById,
    setOperator: conversationRepo.setOperator,
  };
  let released = false;
  conversationRepo.getById = async () => ({ id: 'conv-1', bot_id: 'bot-1', status: 'human' });
  botRepo.getById = async () => ({
    id: 'bot-1', ai_enabled: false, ai_api_key_encrypted: 'encrypted-key',
  });
  conversationRepo.setOperator = async () => { released = true; };
  t.after(() => {
    conversationRepo.getById = originals.getConversation;
    botRepo.getById = originals.getBot;
    conversationRepo.setOperator = originals.setOperator;
  });

  let statusCode;
  let payload;
  const req = { params: { id: 'conv-1' }, app: { get: () => null } };
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };

  await chatController.releaseOperator(req, res);

  assert.equal(statusCode, 409);
  assert.match(payload.error, /Attiva le risposte AI/);
  assert.equal(released, false);
});
