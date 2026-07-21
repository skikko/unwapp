const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/settingsController');

const router = express.Router();
router.use(requireAdmin);
router.get('/twilio', ctrl.getTwilio);
router.put('/twilio', ctrl.updateTwilio);
router.post('/twilio/test', ctrl.testTwilio);

module.exports = router;
