const express = require('express');
const router = express.Router();
const { requireApiKey } = require('../middleware/apiKey');
const ctrl = require('../controllers/outboundController');

router.use(requireApiKey);
router.post('/whatsapp', ctrl.sendWhatsApp);

module.exports = router;
