const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const verifyTwilio = require('../middleware/twilioSignature');

// Twilio posts application/x-www-form-urlencoded
router.use(express.urlencoded({ extended: false }));

router.post('/whatsapp', verifyTwilio, webhookController.handleIncomingMessage);
router.post('/status', verifyTwilio, webhookController.handleDeliveryStatus);

router.get('/test', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

module.exports = router;
