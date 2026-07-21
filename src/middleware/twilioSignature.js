const twilioService = require('../services/twilioService');
const settingsService = require('../services/settingsService');

// Twilio POSTs form-encoded bodies. Express must have parsed them before this
// middleware runs. The public URL that Twilio signed must match req.originalUrl
// with the correct host/proto.
async function verifyTwilio(req, res, next) {
  if (process.env.SKIP_TWILIO_SIGNATURE === 'true') return next();

  const settings = await settingsService.getTwilioSettings();
  const proto = req.header('x-forwarded-proto') || req.protocol;
  const host = req.header('x-forwarded-host') || req.get('host');
  const baseUrl = settings.publicBaseUrl.trim().replace(/\/$/, '') || `${proto}://${host}`;
  const url = `${baseUrl}${req.originalUrl}`;

  if (!await twilioService.validateSignature(req, url)) {
    console.warn('[twilioSignature] invalid signature for', url);
    return res.status(403).send('Invalid Twilio signature');
  }
  next();
}

module.exports = verifyTwilio;
