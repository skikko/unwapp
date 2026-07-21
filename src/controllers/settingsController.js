const settingsService = require('../services/settingsService');
const twilioService = require('../services/twilioService');

function requestOrigin(req) {
  const proto = req.header('x-forwarded-proto') || req.protocol;
  const host = req.header('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

async function getTwilio(req, res) {
  const settings = await settingsService.getTwilioSettings();
  const safe = settingsService.publicTwilioSettings(settings);
  const baseUrl = safe.publicBaseUrl || requestOrigin(req);
  res.json({
    settings: safe,
    urls: {
      inboundWebhook: `${baseUrl}/webhook/whatsapp`,
      statusCallback: `${baseUrl}/webhook/status`,
    },
  });
}

async function updateTwilio(req, res) {
  try {
    const settings = await settingsService.saveTwilioSettings(req.body || {}, req.user.username);
    twilioService.resetClient();
    res.json({ settings: settingsService.publicTwilioSettings(settings) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
}

async function testTwilio(_req, res) {
  try {
    const result = await twilioService.testConnection();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(502).json({ error: 'Connessione Twilio non riuscita', detail: error.message, code: error.code });
  }
}

module.exports = { getTwilio, updateTwilio, testTwilio };
