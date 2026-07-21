const botRepo = require('../repos/botRepo');
const conversationRepo = require('../repos/conversationRepo');
const messageRepo = require('../repos/messageRepo');
const twilioService = require('../services/twilioService');
const contentService = require('../services/contentService');

async function listConversations(req, res) {
  const botId = req.query.botId;
  if (!botId) return res.status(400).json({ error: 'botId required' });
  const bot = await botRepo.getById(botId);
  if (!bot) return res.status(404).json({ error: 'BOT not found' });
  const conversations = await conversationRepo.listByBot(botId, {
    search: req.query.search,
    status: req.query.status,
    broadcast: req.query.broadcast,
  });
  const filters = await conversationRepo.listFiltersByBot(botId);
  res.json({ bot: { id: bot.id, name: bot.name }, conversations, filters });
}

async function getConversation(req, res) {
  const { id } = req.params;
  const conversation = await conversationRepo.getById(id);
  if (!conversation) return res.status(404).json({ error: 'not found' });
  const messages = await messageRepo.listByConversation(id);
  res.json({ conversation, messages });
}

async function sendOperatorMessage(req, res) {
  try {
    const { id } = req.params;
    const body = String(req.body?.message || '').trim();
    const mediaUrl = req.body?.mediaUrl
      ? contentService.requirePublicHttpsUrl(req.body.mediaUrl, 'URL del media') : '';
    const mediaType = String(req.body?.mediaType || '').slice(0, 120);
    const mediaName = String(req.body?.mediaName || '').slice(0, 180);
    const actions = Array.isArray(req.body?.actions) ? req.body.actions : [];
    if (!body && !mediaUrl) return res.status(400).json({ error: 'Inserisci un messaggio o allega un file' });
    if (actions.length && !body) return res.status(400).json({ error: 'Il testo è obbligatorio quando aggiungi pulsanti' });

    const conversation = await conversationRepo.getById(id);
    if (!conversation) return res.status(404).json({ error: 'not found' });
    const bot = await botRepo.getById(conversation.bot_id);
    if (!bot) return res.status(404).json({ error: 'bot not found' });

    await conversationRepo.setOperator(id, req.user?.username || 'operator');
    const savedMessages = [];
    const sentMessages = [];

    if (actions.length) {
      const rich = await twilioService.createRichContent({
        friendlyName: `operator_${Date.now()}`,
        language: bot.language || 'it',
        body,
        mediaUrl,
        actions,
      });
      const sent = await twilioService.sendTemplate({
        from: bot.twilio_number,
        to: conversation.phone_number,
        contentSid: rich.sid,
        contentVariables: {},
      });
      sentMessages.push(sent);
      savedMessages.push(await messageRepo.add(id, 'operator', body, sent.sid, {
        mediaUrl, mediaType, mediaName, actions: rich.actions, contentSid: rich.sid,
      }));
    } else {
      const imageWithCaption = mediaUrl && ['image/jpeg', 'image/png'].includes(mediaType);
      if (body && mediaUrl && !imageWithCaption) {
        const sentText = await twilioService.sendMessage(bot.twilio_number, conversation.phone_number, body);
        sentMessages.push(sentText);
        savedMessages.push(await messageRepo.add(id, 'operator', body, sentText.sid));
      }
      if (mediaUrl) {
        const sentMedia = await twilioService.sendMessage(
          bot.twilio_number,
          conversation.phone_number,
          imageWithCaption ? body : '',
          { mediaUrl }
        );
        sentMessages.push(sentMedia);
        savedMessages.push(await messageRepo.add(
          id, 'operator', imageWithCaption ? body : `📎 ${mediaName || 'Allegato'}`, sentMedia.sid,
          { mediaUrl, mediaType, mediaName }
        ));
      } else if (body) {
        const sentText = await twilioService.sendMessage(bot.twilio_number, conversation.phone_number, body);
        sentMessages.push(sentText);
        savedMessages.push(await messageRepo.add(id, 'operator', body, sentText.sid));
      }
    }

    const io = req.app.get('io');
    if (io) {
      for (const saved of savedMessages) {
        io.to(`bot:${bot.id}`).emit('new-message', {
          conversationId: id,
          botId: bot.id,
          phoneNumber: conversation.phone_number,
          message: {
            role: 'operator', content: saved.content, createdAt: saved.created_at,
            media_url: saved.media_url, media_type: saved.media_type, media_name: saved.media_name,
            actions: saved.actions, content_sid: saved.content_sid,
          },
        });
      }
    }
    res.json({
      success: true,
      twilioSids: sentMessages.map((message) => message.sid),
      messages: savedMessages,
    });
  } catch (error) {
    console.error('[chat] operator send error:', error);
    res.status(error.status || (error.code ? 502 : 400)).json({
      error: error.message,
      code: error.code,
    });
  }
}

async function releaseOperator(req, res) {
  const { id } = req.params;
  const conv = await conversationRepo.setOperator(id, null);
  if (!conv) return res.status(404).json({ error: 'not found' });
  const io = req.app.get('io');
  if (io) {
    io.to(`bot:${conv.bot_id}`).emit('operator-mode-changed', {
      conversationId: conv.id,
      status: conv.status,
    });
  }
  res.json({ success: true, conversation: conv });
}

async function closeConversation(req, res) {
  const { id } = req.params;
  const conv = await conversationRepo.setStatus(id, 'closed');
  if (!conv) return res.status(404).json({ error: 'not found' });
  const io = req.app.get('io');
  if (io) {
    io.to(`bot:${conv.bot_id}`).emit('conversation-closed', {
      conversationId: conv.id,
    });
  }
  res.json({ success: true });
}

async function deleteConversation(req, res) {
  const deleted = await conversationRepo.remove(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Conversazione non trovata' });
  const io = req.app.get('io');
  if (io) {
    io.to(`bot:${deleted.bot_id}`).emit('conversation-deleted', {
      conversationId: deleted.id,
      botId: deleted.bot_id,
    });
  }
  res.json({ success: true });
}

async function deleteMessage(req, res) {
  const { messageId } = req.params;
  const deleted = await messageRepo.remove(messageId);
  if (!deleted) return res.status(404).json({ error: 'not found' });
  res.json({ success: true });
}

module.exports = {
  listConversations,
  getConversation,
  sendOperatorMessage,
  releaseOperator,
  closeConversation,
  deleteConversation,
  deleteMessage,
};
