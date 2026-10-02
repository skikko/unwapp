const express = require('express');
const emailService = require('../services/emailService');

const router = express.Router();
const transparentGif = Buffer.from('R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

router.get('/open.gif', async (req, res) => {
  try {
    await emailService.trackEmailOpen({
      jobId: req.query.jid,
      sig: req.query.sig,
      userAgent: req.get('user-agent') || null,
      ip: req.ip || null,
    });
  } catch (error) {
    console.error('Email open tracking error:', error.message);
  }
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.end(transparentGif);
});

router.get('/click', async (req, res, next) => {
  try {
    const targetUrl = await emailService.trackEmailClick({
      jobId: req.query.jid,
      urlToken: req.query.u,
      sig: req.query.sig,
      userAgent: req.get('user-agent') || null,
      ip: req.ip || null,
    });
    res.redirect(302, targetUrl);
  } catch (error) {
    if (error.status && error.status < 500) return res.status(error.status).send('Invalid tracking link');
    next(error);
  }
});

router.get('/recontact', async (req, res, next) => {
  try {
    const targetUrl = await emailService.requestRecontact({
      jobId: req.query.jid,
      sig: req.query.sig,
      userAgent: req.get('user-agent') || null,
      ip: req.ip || null,
    });
    res.redirect(302, targetUrl);
  } catch (error) {
    if (error.status && error.status < 500) return res.status(error.status).send('Invalid recontact link');
    next(error);
  }
});

module.exports = router;
