const botRepo = require('../repos/botRepo');
const conversationRepo = require('../repos/conversationRepo');
const messageRepo = require('../repos/messageRepo');
const twilioService = require('../services/twilioService');
const aiService = require('../services/aiService');

async function handleIncomingMessage(req, res) {
  try {
    const { From, To, Body, MessageSid } = req.body || {};
    if (!From || !To || !Body || !MessageSid) {
      return res.status(400).send('Missing parameters');
    }

    const bot = await botRepo.getByTwilioNumber(To);
    if (!bot || !bot.active) {
      console.warn('[webhook] no active bot for To=', To);
      return res.status(200).send('OK');
    }

    const fromPhone = twilioService.stripWhatsAppPrefix(From);

    const conversation = await conversationRepo.upsert(bot.id, fromPhone);

    await messageRepo.add(conversation.id, 'user', Body, MessageSid);

    const io = req.app.get('io');
    if (io) {
      io.to(`bot:${bot.id}`).emit('new-message', {
        conversationId: conversation.id,
        botId: bot.id,
        phoneNumber: fromPhone,
        message: { role: 'user', content: Body, createdAt: new Date().toISOString() },
      });
    }

    // A BOT without an AI key remains fully usable for operator-managed chats.
    // Move the conversation to human mode so the dashboard reflects the real
    // state and never attempts an external AI request.
    if (!aiService.isConfigured(bot)) {
      if (conversation.status !== 'human') {
        await conversationRepo.setStatus(conversation.id, 'human');
        if (io) {
          io.to(`bot:${bot.id}`).emit('operator-mode-changed', {
            conversationId: conversation.id,
            status: 'human',
            reason: 'ai_not_configured',
          });
        }
      }
      if (io) {
        io.to(`bot:${bot.id}`).emit('attention-required', {
          conversationId: conversation.id,
          botId: bot.id,
          phoneNumber: fromPhone,
          reason: 'manual_only',
        });
      }
      return res.status(200).send('OK');
    }

    // Skip AI if a human operator has taken over
    if (conversation.status === 'human') {
      return res.status(200).send('OK');
    }

    let aiResponse;
    try {
      aiResponse = await aiService.generateResponse(bot, conversation, Body);
    } catch (err) {
      console.error('[webhook] AI error:', err);
      return res.status(200).send('OK');
    }

    let sent;
    try {
      sent = await twilioService.sendMessage(bot.twilio_number, fromPhone, aiResponse);
    } catch (err) {
      console.error('[webhook] Twilio send error:', err.message);
      return res.status(200).send('OK');
    }

    await messageRepo.add(conversation.id, 'bot', aiResponse, sent.sid);

    if (io) {
      io.to(`bot:${bot.id}`).emit('new-message', {
        conversationId: conversation.id,
        botId: bot.id,
        phoneNumber: fromPhone,
        message: { role: 'bot', content: aiResponse, createdAt: new Date().toISOString() },
      });
    }

    try {
      const needsHuman = await aiService.shouldTransferToHuman(bot, conversation, Body);
      if (needsHuman && io) {
        io.to(`bot:${bot.id}`).emit('attention-required', {
          conversationId: conversation.id,
          botId: bot.id,
          phoneNumber: fromPhone,
        });
      }
    } catch (err) {
      console.error('[webhook] transfer-check error:', err.message);
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('[webhook] unexpected error:', error);
    return res.status(500).send('Internal server error');
  }
}

async function handleDeliveryStatus(req, res) {
  const { MessageSid, MessageStatus } = req.body || {};
  console.log(`[webhook] status ${MessageSid}: ${MessageStatus}`);
  res.status(200).send('OK');
}

module.exports = { handleIncomingMessage, handleDeliveryStatus };
