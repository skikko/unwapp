const test = require('node:test');
const assert = require('node:assert/strict');

const broadcastRepo = require('../src/repos/broadcastRepo');
const conversationRepo = require('../src/repos/conversationRepo');
const messageRepo = require('../src/repos/messageRepo');
const twilioService = require('../src/services/twilioService');
const broadcastService = require('../src/services/broadcastService');

test('stores every accepted broadcast template in an existing or new conversation', async (t) => {
  const originals = {
    getCampaign: broadcastRepo.getCampaign,
    markRunning: broadcastRepo.markRunning,
    nextPendingRecipient: broadcastRepo.nextPendingRecipient,
    markRecipientSent: broadcastRepo.markRecipientSent,
    refreshCounts: broadcastRepo.refreshCounts,
    markCompleted: broadcastRepo.markCompleted,
    markFailed: broadcastRepo.markFailed,
    upsert: conversationRepo.upsert,
    add: messageRepo.add,
    sendTemplate: twilioService.sendTemplate,
    getTemplate: twilioService.getTemplate,
  };
  t.after(() => {
    Object.assign(broadcastRepo, {
      getCampaign: originals.getCampaign,
      markRunning: originals.markRunning,
      nextPendingRecipient: originals.nextPendingRecipient,
      markRecipientSent: originals.markRecipientSent,
      refreshCounts: originals.refreshCounts,
      markCompleted: originals.markCompleted,
      markFailed: originals.markFailed,
    });
    conversationRepo.upsert = originals.upsert;
    messageRepo.add = originals.add;
    twilioService.sendTemplate = originals.sendTemplate;
    twilioService.getTemplate = originals.getTemplate;
    broadcastService.setSocketServer(null);
  });

  const campaign = {
    id: 'campaign-1',
    bot_id: 'bot-1',
    status: 'queued',
    twilio_number: '+15550000000',
    template_sid: `HX${'a'.repeat(32)}`,
    template_name: 'welcome',
  };
  const recipients = [
    { id: 'recipient-1', phone_number: '+393331111111', content_variables: { 1: 'Mario', 2: 'A1' } },
    { id: 'recipient-2', phone_number: '+393332222222', content_variables: { 1: 'Giulia', 2: 'B2' } },
  ];
  const sentRecipients = [];
  const upserts = [];
  const storedMessages = [];
  const events = [];

  broadcastRepo.getCampaign = async () => campaign;
  broadcastRepo.markRunning = async () => {};
  broadcastRepo.nextPendingRecipient = async () => recipients.shift() || null;
  broadcastRepo.markRecipientSent = async (id, sid) => { sentRecipients.push({ id, sid }); };
  broadcastRepo.refreshCounts = async () => {};
  broadcastRepo.markCompleted = async () => {};
  broadcastRepo.markFailed = async () => {};
  conversationRepo.upsert = async (botId, phoneNumber) => {
    upserts.push({ botId, phoneNumber });
    return { id: `conversation-${phoneNumber}`, bot_id: botId, phone_number: phoneNumber };
  };
  messageRepo.add = async (conversationId, role, content, twilioSid, metadata) => {
    const saved = {
      conversationId,
      role,
      content,
      twilio_sid: twilioSid,
      content_sid: metadata.contentSid,
      actions: metadata.actions,
      created_at: '2026-07-28T12:00:00.000Z',
    };
    storedMessages.push(saved);
    return saved;
  };
  twilioService.getTemplate = async () => ({
    body: 'Ciao {{1}}, apri la pratica {{2}}.',
    actions: [{ type: 'URL', title: 'Apri', url: 'https://example.com/{{2}}' }],
  });
  twilioService.sendTemplate = async ({ to }) => ({ sid: `SM-${to}` });
  broadcastService.setSocketServer({
    to: () => ({
      emit: (name, payload) => events.push({ name, payload }),
    }),
  });

  await broadcastService.runCampaign(campaign.id);

  assert.equal(sentRecipients.length, 2);
  assert.deepEqual(upserts, [
    { botId: 'bot-1', phoneNumber: '+393331111111' },
    { botId: 'bot-1', phoneNumber: '+393332222222' },
  ]);
  assert.equal(storedMessages[0].content, 'Ciao Mario, apri la pratica A1.');
  assert.equal(storedMessages[1].content, 'Ciao Giulia, apri la pratica B2.');
  assert.equal(storedMessages[0].actions[0].url, 'https://example.com/A1');
  assert.ok(storedMessages.every((message) => message.role === 'operator'));
  assert.ok(storedMessages.every((message) => message.content_sid === campaign.template_sid));
  assert.equal(events.filter((event) => event.name === 'new-message').length, 2);
});
