const express = require('express');
const emailService = require('../services/emailService');
const recontactService = require('../services/recontactService');

const router = express.Router();

function allowedOrigins() {
  const configured = String(process.env.CRM_PUBLIC_ORIGINS || 'https://www.unitednetwork.it,https://unitednetwork.it')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(configured);
}

function publicCors(req, res, next) {
  const origin = req.get('origin');
  const origins = allowedOrigins();
  if (origin && (origins.has('*') || origins.has(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
}

router.options('/recontact-request', publicCors);
router.options('/recontact-profile', publicCors);
router.options('/recontact-contact', publicCors);

router.post('/recontact-profile', publicCors, async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await emailService.getRecontactProfile({ token: req.body?.token });
    res.json(result);
  } catch (error) {
    if (error.status && error.status < 500) {
      return res.status(error.status).json({ error: 'Richiesta non valida' });
    }
    next(error);
  }
});

router.post('/recontact-request', publicCors, async (req, res, next) => {
  try {
    const result = await emailService.confirmRecontact({
      token: req.body?.token || req.query.token,
      phone: req.body?.phone,
      userAgent: req.get('user-agent') || null,
      ip: req.ip || null,
    });
    res.json(result);
  } catch (error) {
    if (error.status && error.status < 500) {
      return res.status(error.status).json({ error: 'Richiesta non valida' });
    }
    return next(error);
  }
});

router.post('/recontact-contact', publicCors, async (req, res, next) => {
  try {
    const origin = req.get('origin');
    if (!origin || !allowedOrigins().has(origin)) {
      return res.status(403).json({ error: 'Origine non autorizzata' });
    }
    const result = await recontactService.registerManualRequest(req.body || {});
    return res.status(result.ignored ? 200 : 201).json(result);
  } catch (error) {
    if (error.status && error.status < 500) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
});

module.exports = router;
