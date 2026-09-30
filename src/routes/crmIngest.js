const express = require('express');
const { requireApiScope } = require('../middleware/apiKey');
const crmIngestService = require('../services/crmIngestService');

const router = express.Router();
router.use(requireApiScope('contacts:write', { allowLegacy: false }));

router.post('/contacts', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.contacts) ? req.body.contacts : [req.body];
    if (!items.length || items.length > 1000) {
      return res.status(400).json({ error: 'La richiesta deve contenere da 1 a 1000 contatti' });
    }
    const idempotencyKey = String(req.header('idempotency-key') || '').trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return res.status(400).json({ error: 'Idempotency-Key obbligatoria e lunga al massimo 200 caratteri' });
    }
    const requestedSource = String(req.body?.source || req.header('x-contact-source') || 'api').slice(0, 80);
    const source = req.apiClient.source || requestedSource;
    const result = await crmIngestService.ingest({
      items,
      source,
      apiClient: req.apiClient,
      idempotencyKey,
    });
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return res.status(result.statusCode).json(result.payload);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
});

module.exports = router;
