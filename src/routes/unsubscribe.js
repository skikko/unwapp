const express = require('express');
const emailService = require('../services/emailService');

const router = express.Router();

function page(title, message) {
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f4f1ec; color: #252a35; }
    main { max-width: 640px; margin: 12vh auto; padding: 32px; background: #fff; border: 1px solid #e3ddd5; }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { margin: 0; line-height: 1.6; }
  </style>
</head>
<body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`;
}

router.get('/', async (req, res) => {
  try {
    await emailService.unsubscribeContact(req.query);
    res.type('html').send(page('Disiscrizione confermata', 'Non riceverai più comunicazioni email da United Network su questo indirizzo.'));
  } catch (_error) {
    res.status(400).type('html').send(page('Link non valido', 'Il link di disiscrizione non è valido o non è più utilizzabile.'));
  }
});

module.exports = router;
