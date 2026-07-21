const broadcastRepo = require('../repos/broadcastRepo');
const twilioService = require('./twilioService');

const running = new Set();
const delayMs = Math.max(0, Number(process.env.BROADCAST_DELAY_MS || 100));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCampaign(campaignId) {
  if (running.has(campaignId)) return;
  running.add(campaignId);
  try {
    const campaign = await broadcastRepo.getCampaign(campaignId);
    if (!campaign || !['queued', 'running'].includes(campaign.status)) return;
    await broadcastRepo.markRunning(campaignId);

    let recipient = await broadcastRepo.nextPendingRecipient(campaignId);
    let processedSinceRefresh = 0;
    while (recipient) {
      try {
        const message = await twilioService.sendTemplate({
          from: campaign.twilio_number,
          to: recipient.phone_number,
          contentSid: campaign.template_sid,
          contentVariables: recipient.content_variables || {},
        });
        await broadcastRepo.markRecipientSent(recipient.id, message.sid);
      } catch (error) {
        console.error(`[broadcast:${campaignId}] recipient ${recipient.id}:`, error.message);
        await broadcastRepo.markRecipientFailed(recipient.id, error);
      }

      processedSinceRefresh += 1;
      if (processedSinceRefresh >= 10) {
        await broadcastRepo.refreshCounts(campaignId);
        processedSinceRefresh = 0;
      }
      if (delayMs) await wait(delayMs);
      recipient = await broadcastRepo.nextPendingRecipient(campaignId);
    }
    await broadcastRepo.markCompleted(campaignId);
  } catch (error) {
    console.error(`[broadcast:${campaignId}] stopped:`, error);
    await broadcastRepo.markFailed(campaignId, error.message).catch(() => {});
  } finally {
    running.delete(campaignId);
  }
}

function enqueue(campaignId) {
  setImmediate(() => runCampaign(campaignId));
}

async function resumePending() {
  const ids = await broadcastRepo.pendingCampaignIds();
  ids.forEach(enqueue);
  return ids.length;
}

module.exports = { enqueue, runCampaign, resumePending };
