const express = require('express');
const multer = require('multer');
const { requirePermission } = require('../middleware/auth');
const ctrl = require('../controllers/broadcastController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.get('/templates', requirePermission('broadcast:read'), ctrl.listTemplates);
router.post('/templates', requirePermission('broadcast:write'), ctrl.createTemplate);
router.post('/preview', requirePermission('broadcast:write'), upload.single('contacts'), ctrl.previewCsv);
router.get('/campaigns', requirePermission('broadcast:read'), ctrl.listCampaigns);
router.post('/campaigns', requirePermission('broadcast:write'), upload.single('contacts'), ctrl.createCampaign);
router.get('/campaigns/:id', requirePermission('broadcast:read'), ctrl.getCampaign);

module.exports = router;
