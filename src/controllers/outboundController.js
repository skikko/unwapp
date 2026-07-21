const botRepo = require('../repos/botRepo');
const conversationRepo = require('../repos/conversationRepo');
const messageRepo = require('../repos/messageRepo');
const twilioService = require('../services/twilioService');

// POST /api/outbound/whatsapp
// Body:
//   {
//     "botSlug": "assistenza-imun",          // or "botId"
//     "to": "+393280558866",
//     "contentSid": "HX...",                 // for approved WhatsApp template
//     "variables": { "1": "Mario", "2": "Rossi" },  // optional, for template placeholders
//     "body": "ciao"                          // alternative: free-form body (24h window only)
//   }
// Response: { success, messageSid, conversationId, status }
async function sendWhatsApp(req, res) {
  try {
    const { botSlug, botId, to, contentSid, variables, body } = req.body || {};
    const resolvedBotSlug = botSlug;
    const resolvedBotId = botId;

    if (!to) return res.status(400).json({ error: 'to required (E.164, e.g. +393280558866)' });
    if (!contentSid && !body) {
      return res.status(400).json({ error: 'contentSid or body required' });
    }
    if (!resolvedBotSlug && !resolvedBotId) {
      return res.status(400).json({ error: 'botSlug or botId required' });
    }

    const bot = resolvedBotId
      ? await botRepo.getById(resolvedBotId)
      : await botRepo.getBySlug(resolvedBotSlug);

    if (!bot) return res.status(404).json({ error: 'BOT not found' });
    if (!bot.active) return res.status(409).json({ error: 'BOT is inactive' });

    let message;
    if (contentSid) {
      message = await twilioService.sendTemplate({
        from: bot.twilio_number,
        to,
        contentSid,
        contentVariables: variables || {},
      });
    } else {
      message = await twilioService.sendMessage(bot.twilio_number, to, body);
    }

    // Record the outbound message in its conversation so it shows up in the dashboard
    const phone = twilioService.stripWhatsAppPrefix(to);
    const conv = await conversationRepo.upsert(bot.id, phone);
    const content = contentSid ? `[template:${contentSid}]` + (variables ? ` ${JSON.stringify(variables)}` : '') : body;
    await messageRepo.add(conv.id, 'bot', content, message.sid);

    const io = req.app.get('io');
    if (io) {
      io.to(`bot:${bot.id}`).emit('new-message', {
        conversationId: conv.id,
        botId: bot.id,
        phoneNumber: phone,
        message: { role: 'bot', content, createdAt: new Date().toISOString() },
      });
    }

    res.json({
      success: true,
      messageSid: message.sid,
      conversationId: conv.id,
      status: message.status,
    });
  } catch (err) {
    console.error('[outbound] error:', err);
    res.status(502).json({
      error: 'send failed',
      detail: err.message,
      code: err.code,
      moreInfo: err.moreInfo,
    });
  }
}

module.exports = { sendWhatsApp };
