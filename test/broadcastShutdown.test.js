const test = require('node:test');
const assert = require('node:assert/strict');

const broadcastRepo = require('../src/repos/broadcastRepo');
const conversationRepo = require('../src/repos/conversationRepo');
const messageRepo = require('../src/repos/messageRepo');
const twilioService = require('../src/services/twilioService');
const broadcastService = require('../src/services/broadcastService');

test('graceful shutdown finishes the claimed recipient without claiming another one', async (t) => {
  const originals = {
    getCampaign: broadcastRepo.getCampaign,
    markRunning: broadcastRepo.markRunning,
    claimNextRecipient: broadcastRepo.claimNextRecipient,
    markRecipientSent: broadcastRepo.markRecipientSent,
    refreshCounts: broadcastRepo.refreshCounts,
    markCompletedIfIdle: broadcastRepo.markCompletedIfIdle,
    upsert: conversationRepo.upsert,
    add: messageRepo.add,
    sendTemplate: twilioService.sendTemplate,
    getTemplate: twilioService.getTemplate,
  };
  t.after(() => {
    Object.assign(broadcastRepo, {
      getCampaign: originals.getCampaign,
      markRunning: originals.markRunning,
      claimNextRecipient: originals.claimNextRecipient,
      markRecipientSent: originals.markRecipientSent,
      refreshCounts: originals.refreshCounts,
      markCompletedIfIdle: originals.markCompletedIfIdle,
    });
    conversationRepo.upsert = originals.upsert;
    messageRepo.add = originals.add;
    twilioService.sendTemplate = originals.sendTemplate;
    twilioService.getTemplate = originals.getTemplate;
  });

  let releaseSend;
  const sendStarted = new Promise((resolve) => {
    twilioService.sendTemplate = async () => {
      resolve();
      return new Promise((release) => { releaseSend = () => release({ sid: 'SM-1' }); });
    };
  });
  let claimCount = 0;
  broadcastRepo.getCampaign = async () => ({
    id: 'campaign-1',
    bot_id: 'bot-1',
    status: 'running',
    twilio_number: '+15550000000',
    template_sid: `HX${'a'.repeat(32)}`,
  });
  broadcastRepo.markRunning = async () => {};
  broadcastRepo.claimNextRecipient = async () => {
    claimCount += 1;
    return {
      id: 'recipient-1',
      claim_token: 'claim-1',
      phone_number: '+393331111111',
      content_variables: {},
    };
  };
  broadcastRepo.markRecipientSent = async () => true;
  broadcastRepo.refreshCounts = async () => {};
  broadcastRepo.markCompletedIfIdle = async () => null;
  conversationRepo.upsert = async () => ({ id: 'conversation-1' });
  messageRepo.add = async () => ({
    role: 'operator',
    content: 'Test',
    created_at: new Date().toISOString(),
  });
  twilioService.getTemplate = async () => ({ body: 'Test', actions: [] });

  const campaign = broadcastService.runCampaign('campaign-1');
  await sendStarted;
  broadcastService.beginShutdown();
  releaseSend();
  await broadcastService.waitForIdle();
  await campaign;

  assert.equal(claimCount, 1);
});
