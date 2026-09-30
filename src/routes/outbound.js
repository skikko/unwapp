const express = require('express');
const router = express.Router();
const { requireApiScope } = require('../middleware/apiKey');
const ctrl = require('../controllers/outboundController');

router.use(requireApiScope('whatsapp:send'));
router.post('/whatsapp', ctrl.sendWhatsApp);

module.exports = router;
