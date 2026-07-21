const express = require('express');
const multer = require('multer');
const { requirePermission } = require('../middleware/auth');
const ragService = require('../services/ragService');
const botRepo = require('../repos/botRepo');
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(file.mimetype === 'application/pdf' ? null : new Error('only PDF allowed'),
       file.mimetype === 'application/pdf');
  },
});

// List documents for a bot
router.get('/', requirePermission('bots:read'), async (req, res) => {
  const botId = req.query.botId;
  if (!botId) return res.status(400).json({ error: 'botId required' });
  const documents = await ragService.listDocuments(botId);
  res.json({ documents });
});

// Upload (botId in query OR form field)
router.post('/upload', requirePermission('admin'), upload.single('document'), async (req, res) => {
  try {
    const botId = req.body.botId || req.query.botId;
    if (!botId) return res.status(400).json({ error: 'botId required' });
    if (!req.file) return res.status(400).json({ error: 'no file uploaded' });

    const bot = await botRepo.getById(botId);
    if (!bot) return res.status(404).json({ error: 'BOT non trovato' });
    const result = await ragService.uploadDocument(bot, req.file);
    res.json({ message: 'Document uploaded', ...result });
  } catch (err) {
    console.error('[documents] upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:documentId', requirePermission('admin'), async (req, res) => {
  try {
    const botId = req.query.botId;
    if (!botId) return res.status(400).json({ error: 'botId required' });
    await ragService.deleteDocument(botId, req.params.documentId);
    res.json({ success: true });
  } catch (err) {
    console.error('[documents] delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', requirePermission('bots:read'), async (req, res) => {
  const botId = req.query.botId;
  if (!botId) return res.status(400).json({ error: 'botId required' });
  const stats = await ragService.stats(botId);
  res.json(stats);
});

module.exports = router;
