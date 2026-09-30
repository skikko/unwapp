const express = require('express');
const multer = require('multer');
const { requirePermission } = require('../middleware/auth');
const mediaController = require('../controllers/mediaController');
const mediaService = require('../services/mediaService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: mediaService.MAX_MEDIA_BYTES },
});

router.post('/upload/chat', requirePermission('chat:write'), upload.single('media'), mediaController.upload('chat'));
router.post('/upload/broadcast', requirePermission('broadcast:write'), upload.single('media'), mediaController.upload('broadcast'));
router.post('/upload/crm', requirePermission('crm:write'), upload.single('media'), mediaController.upload('email'));
router.get('/:token/:filename', mediaController.serve);
router.get('/:token', mediaController.serve);

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `Il file supera il limite di ${Math.floor(mediaService.MAX_MEDIA_BYTES / (1024 * 1024))} MB`,
    });
  }

  return next(error);
});

module.exports = router;
