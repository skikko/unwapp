const botRepo = require('../repos/botRepo');
const conversationRepo = require('../repos/conversationRepo');
const messageRepo = require('../repos/messageRepo');
const twilioService = require('../services/twilioService');
const aiService = require('../services/aiService');
const mediaService = require('../services/mediaService');
const crmService = require('../services/crmService');
const broadcastRepo = require('../repos/broadcastRepo');

async function handleIncomingMessage(req, res) {
  try {
    const { From, To, Body, MessageSid, MediaUrl0, MediaContentType0 } = req.body || {};
    const bodyText = String(Body || '').trim();
    const hasMedia = Number(req.body?.NumMedia || 0) > 0 && Boolean(MediaUrl0);
    if (!From || !To || (!bodyText && !hasMedia) || !MessageSid) {
      return res.status(400).send('Missing parameters');
    }
    if (await messageRepo.getByTwilioSid(MessageSid)) return res.status(200).send('OK');

    const bot = await botRepo.getByTwilioNumber(To);
    if (!bot || !bot.active) {
      console.warn('[webhook] no active bot for To=', To);
      return res.status(200).send('OK');
    }

    const fromPhone = twilioService.stripWhatsAppPrefix(From);

    const conversation = await conversationRepo.upsert(bot.id, fromPhone);

    try {
      await crmService.saveContact({
        firstName: req.body?.ProfileName || null,
        phone: fromPhone,
        source: 'whatsapp',
        customFields: { lastBotId: bot.id },
      }, { defaultSource: 'whatsapp' });
    } catch (error) {
      console.error('[webhook] CRM contact sync error:', error.message);
    }

    let media = {};
    if (hasMedia) {
      try {
        const asset = await mediaService.importFromTwilio(MediaUrl0, MediaContentType0, { req });
        media = {
          mediaUrl: asset.url,
          mediaType: asset.content_type,
          mediaName: asset.filename,
        };
      } catch (error) {
        console.error('[webhook] media import error:', error.message);
        media = {
          mediaType: String(MediaContentType0 || ''),
          mediaName: 'Allegato WhatsApp non disponibile',
        };
      }
    }
    const incomingContent = bodyText || `📎 ${media.mediaName || 'Allegato WhatsApp'}`;
    if (hasMedia) {
      await messageRepo.add(conversation.id, 'user', incomingContent, MessageSid, media);
    } else {
      await messageRepo.add(conversation.id, 'user', incomingContent, MessageSid);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`bot:${bot.id}`).emit('new-message', {
        conversationId: conversation.id,
        botId: bot.id,
        phoneNumber: fromPhone,
        message: {
          role: 'user', content: incomingContent, createdAt: new Date().toISOString(),
          media_url: media.mediaUrl || null,
          media_type: media.mediaType || null,
          media_name: media.mediaName || null,
          actions: [],
        },
      });
    }

    // Inbound attachments require an operator: the configured text models do
    // not inspect arbitrary WhatsApp media and must not fabricate a response.
    if (hasMedia) {
      if (conversation.status !== 'human') {
        await conversationRepo.setStatus(conversation.id, 'human');
        if (io) {
          io.to(`bot:${bot.id}`).emit('operator-mode-changed', {
            conversationId: conversation.id,
            status: 'human',
            reason: 'incoming_media',
          });
        }
      }
      if (io) {
        io.to(`bot:${bot.id}`).emit('attention-required', {
          conversationId: conversation.id,
          botId: bot.id,
          phoneNumber: fromPhone,
          reason: 'incoming_media',
        });
      }
      return res.status(200).send('OK');
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
      aiResponse = await aiService.generateResponse(bot, conversation, bodyText);
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
      const needsHuman = await aiService.shouldTransferToHuman(bot, conversation, bodyText);
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
  const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body || {};
  if (!MessageSid || !MessageStatus) return res.status(400).send('Missing parameters');
  await Promise.all([
    messageRepo.updateDeliveryStatus(MessageSid, MessageStatus),
    broadcastRepo.updateDeliveryStatus(MessageSid, MessageStatus, ErrorCode || null, ErrorMessage || null),
  ]);
  console.log(`[webhook] status ${MessageSid}: ${MessageStatus}`);
  res.status(200).send('OK');
}

module.exports = { handleIncomingMessage, handleDeliveryStatus };
