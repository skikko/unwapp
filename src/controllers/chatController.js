const botRepo = require('../repos/botRepo');
const conversationRepo = require('../repos/conversationRepo');
const messageRepo = require('../repos/messageRepo');
const twilioService = require('../services/twilioService');

async function listConversations(req, res) {
  const botId = req.query.botId || req.query.botId;
  if (!botId) return res.status(400).json({ error: 'botId required' });
  const bot = await botRepo.getById(botId);
  if (!bot) return res.status(404).json({ error: 'BOT not found' });
  const conversations = await conversationRepo.listByBot(botId);
  res.json({ bot: { id: bot.id, name: bot.name }, conversations });
}

async function getConversation(req, res) {
  const { id } = req.params;
  const conversation = await conversationRepo.getById(id);
  if (!conversation) return res.status(404).json({ error: 'not found' });
  const messages = await messageRepo.listByConversation(id);
  res.json({ conversation, messages });
}

async function sendOperatorMessage(req, res) {
  const { id } = req.params;
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }
  const conversation = await conversationRepo.getById(id);
  if (!conversation) return res.status(404).json({ error: 'not found' });

  const bot = await botRepo.getById(conversation.bot_id);
  if (!bot) return res.status(404).json({ error: 'bot not found' });

  await conversationRepo.setOperator(id, req.user?.username || 'operator');

  const sent = await twilioService.sendMessage(
    bot.twilio_number,
    conversation.phone_number,
    message.trim()
  );
  const saved = await messageRepo.add(id, 'operator', message.trim(), sent.sid);

  const io = req.app.get('io');
  if (io) {
    io.to(`bot:${bot.id}`).emit('new-message', {
      conversationId: id,
      botId: bot.id,
      phoneNumber: conversation.phone_number,
      message: { role: 'operator', content: saved.content, createdAt: saved.created_at },
    });
  }
  res.json({ success: true, twilioSid: sent.sid, message: saved });
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
  deleteMessage,
};
