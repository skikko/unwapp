const broadcastRepo = require('../repos/broadcastRepo');
const conversationRepo = require('../repos/conversationRepo');
const messageRepo = require('../repos/messageRepo');
const twilioService = require('./twilioService');

const running = new Map();
const delayMs = Math.max(0, Number(process.env.BROADCAST_DELAY_MS || 100));
const configuredClaimTimeout = Number(process.env.BROADCAST_CLAIM_TIMEOUT_MINUTES || 60);
const claimTimeoutMinutes = Number.isFinite(configuredClaimTimeout) && configuredClaimTimeout > 0
  ? configuredClaimTimeout
  : 60;
let socketServer = null;
let stopping = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function interpolateTemplateValue(value, variables) {
  return String(value || '').replace(/\{\{(\d+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return String(variables[key]);
    }
    return match;
  });
}

function buildChatMessage(campaign, recipient, template) {
  const variables = recipient.content_variables || {};
  const fallback = `Template: ${campaign.template_name || campaign.template_sid}`;
  const content = interpolateTemplateValue(template?.body, variables) || fallback;
  const actions = (template?.actions || []).map((action) => Object.fromEntries(
    Object.entries(action).map(([key, value]) => [
      key,
      typeof value === 'string' ? interpolateTemplateValue(value, variables) : value,
    ])
  ));
  return {
    content,
    metadata: {
      actions,
      contentSid: campaign.template_sid,
    },
  };
}

async function saveChatMessage(campaign, recipient, template, twilioSid) {
  const conversation = await conversationRepo.upsert(campaign.bot_id, recipient.phone_number);
  const chatMessage = buildChatMessage(campaign, recipient, template);
  const saved = await messageRepo.add(
    conversation.id,
    'operator',
    chatMessage.content,
    twilioSid,
    chatMessage.metadata
  );

  if (socketServer) {
    socketServer.to(`bot:${campaign.bot_id}`).emit('new-message', {
      conversationId: conversation.id,
      botId: campaign.bot_id,
      phoneNumber: recipient.phone_number,
      message: {
        role: saved.role,
        content: saved.content,
        createdAt: saved.created_at,
        media_url: saved.media_url,
        media_type: saved.media_type,
        media_name: saved.media_name,
        actions: saved.actions,
        content_sid: saved.content_sid,
      },
    });
  }
}

async function processCampaign(campaignId) {
  try {
    const campaign = await broadcastRepo.getCampaign(campaignId);
    if (!campaign || !['queued', 'running'].includes(campaign.status)) return;
    await broadcastRepo.markRunning(campaignId);
    let template = null;
    try {
      template = await twilioService.getTemplate(campaign.template_sid);
    } catch (error) {
      console.warn(`[broadcast:${campaignId}] template fetch failed:`, error.message);
    }

    let processedSinceRefresh = 0;
    while (!stopping) {
      const recipient = await broadcastRepo.claimNextRecipient(campaignId);
      if (!recipient) break;
      try {
        const message = await twilioService.sendTemplate({
          from: campaign.twilio_number,
          to: recipient.phone_number,
          contentSid: campaign.template_sid,
          contentVariables: recipient.content_variables || {},
        });
        const marked = await broadcastRepo.markRecipientSent(
          recipient.id,
          recipient.claim_token,
          message.sid
        );
        if (!marked) throw new Error('Broadcast recipient claim was lost before confirmation');
        try {
          await saveChatMessage(campaign, recipient, template, message.sid);
        } catch (error) {
          console.error(`[broadcast:${campaignId}] chat persistence failed for ${recipient.id}:`, error.message);
        }
      } catch (error) {
        console.error(`[broadcast:${campaignId}] recipient ${recipient.id}:`, error.message);
        await broadcastRepo.markRecipientFailed(recipient.id, recipient.claim_token, error);
      }

      processedSinceRefresh += 1;
      if (processedSinceRefresh >= 10) {
        await broadcastRepo.refreshCounts(campaignId);
        processedSinceRefresh = 0;
      }
      if (delayMs) await wait(delayMs);
    }
    await broadcastRepo.markCompletedIfIdle(campaignId);
  } catch (error) {
    console.error(`[broadcast:${campaignId}] stopped:`, error);
  }
}

function runCampaign(campaignId) {
  if (stopping) return Promise.resolve();
  if (running.has(campaignId)) return running.get(campaignId);
  const task = processCampaign(campaignId).finally(() => running.delete(campaignId));
  running.set(campaignId, task);
  return task;
}

function enqueue(campaignId) {
  if (stopping) return false;
  setImmediate(() => runCampaign(campaignId));
  return true;
}

function setSocketServer(io) {
  socketServer = io;
}

async function resumePending() {
  await broadcastRepo.verifyClaimSchema();
  const staleClaims = await broadcastRepo.failStaleClaims(claimTimeoutMinutes);
  if (staleClaims) {
    console.warn(`WARN ${staleClaims} stale broadcast claims marked as failed`);
  }
  const ids = await broadcastRepo.pendingCampaignIds();
  ids.forEach(enqueue);
  return ids.length;
}

function beginShutdown() {
  stopping = true;
}

async function waitForIdle() {
  await Promise.allSettled([...running.values()]);
}

module.exports = {
  enqueue,
  runCampaign,
  resumePending,
  setSocketServer,
  beginShutdown,
  waitForIdle,
};
