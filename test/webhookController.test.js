const test = require('node:test');
const assert = require('node:assert/strict');

const botRepo = require('../src/repos/botRepo');
const conversationRepo = require('../src/repos/conversationRepo');
const messageRepo = require('../src/repos/messageRepo');
const aiService = require('../src/services/aiService');
const crmService = require('../src/services/crmService');
const webhookController = require('../src/controllers/webhookController');

test('stores incoming messages and switches to human mode without an AI key', async (t) => {
  const originals = {
    getByTwilioNumber: botRepo.getByTwilioNumber,
    upsert: conversationRepo.upsert,
    setStatus: conversationRepo.setStatus,
    add: messageRepo.add,
    getByTwilioSid: messageRepo.getByTwilioSid,
    generateResponse: aiService.generateResponse,
    saveContact: crmService.saveContact,
  };
  t.after(() => {
    botRepo.getByTwilioNumber = originals.getByTwilioNumber;
    conversationRepo.upsert = originals.upsert;
    conversationRepo.setStatus = originals.setStatus;
    messageRepo.add = originals.add;
    messageRepo.getByTwilioSid = originals.getByTwilioSid;
    aiService.generateResponse = originals.generateResponse;
    crmService.saveContact = originals.saveContact;
  });

  const bot = {
    id: 'bot-1',
    active: true,
    twilio_number: 'whatsapp:+14155238886',
    ai_api_key_encrypted: null,
  };
  const conversation = { id: 'conv-1', status: 'active' };
  let storedMessage;
  let statusChange;
  let aiCalled = false;
  const events = [];

  botRepo.getByTwilioNumber = async () => bot;
  conversationRepo.upsert = async () => conversation;
  conversationRepo.setStatus = async (id, status) => {
    statusChange = { id, status };
    return { ...conversation, status };
  };
  messageRepo.add = async (...args) => { storedMessage = args; };
  messageRepo.getByTwilioSid = async () => null;
  aiService.generateResponse = async () => { aiCalled = true; return 'unexpected'; };
  crmService.saveContact = async () => ({});

  const io = {
    to() {
      return { emit(name, data) { events.push({ name, data }); } };
    },
  };
  const req = {
    body: {
      From: 'whatsapp:+393331234567',
      To: 'whatsapp:+14155238886',
      Body: 'Buongiorno',
      MessageSid: 'SM123',
    },
    app: { get: () => io },
  };
  let statusCode;
  let responseBody;
  const res = {
    status(code) { statusCode = code; return this; },
    send(body) { responseBody = body; return this; },
  };

  await webhookController.handleIncomingMessage(req, res);

  assert.equal(statusCode, 200);
  assert.equal(responseBody, 'OK');
  assert.deepEqual(storedMessage, ['conv-1', 'user', 'Buongiorno', 'SM123']);
  assert.deepEqual(statusChange, { id: 'conv-1', status: 'human' });
  assert.equal(aiCalled, false);
  assert.ok(events.some((event) => event.name === 'attention-required'));
  assert.ok(events.some((event) => event.name === 'operator-mode-changed'));
});
