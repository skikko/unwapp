const test = require('node:test');
const assert = require('node:assert/strict');

const botRepo = require('../src/repos/botRepo');
const conversationRepo = require('../src/repos/conversationRepo');
const messageRepo = require('../src/repos/messageRepo');
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

test('blocca messaggi liberi fuori dalla finestra WhatsApp di 24 ore', async (t) => {
  const originals = {
    getConversation: conversationRepo.getById,
    getBot: botRepo.getById,
    isWindowOpen: messageRepo.isCustomerServiceWindowOpen,
    setOperator: conversationRepo.setOperator,
  };
  let operatorChanged = false;
  conversationRepo.getById = async () => ({ id: 'conv-1', bot_id: 'bot-1' });
  botRepo.getById = async () => ({ id: 'bot-1' });
  messageRepo.isCustomerServiceWindowOpen = async () => false;
  conversationRepo.setOperator = async () => { operatorChanged = true; };
  t.after(() => {
    conversationRepo.getById = originals.getConversation;
    botRepo.getById = originals.getBot;
    messageRepo.isCustomerServiceWindowOpen = originals.isWindowOpen;
    conversationRepo.setOperator = originals.setOperator;
  });

  let statusCode;
  let payload;
  const req = {
    params: { id: 'conv-1' },
    body: { message: 'Test' },
    app: { get: () => null },
  };
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { payload = body; return this; },
  };

  await chatController.sendOperatorMessage(req, res);

  assert.equal(statusCode, 409);
  assert.equal(payload.code, 'WHATSAPP_WINDOW_CLOSED');
  assert.equal(operatorChanged, false);
});
