const botRepo = require('../repos/botRepo');
const broadcastRepo = require('../repos/broadcastRepo');
const broadcastService = require('../services/broadcastService');
const csvService = require('../services/csvService');
const twilioService = require('../services/twilioService');

function parseMapping(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { throw new Error('Mappatura variabili non valida'); }
}

async function listTemplates(_req, res) {
  try {
    const templates = await twilioService.listTemplates();
    res.json({ templates });
  } catch (error) {
    res.status(502).json({ error: 'Impossibile leggere i template Twilio', detail: error.message });
  }
}

async function previewCsv(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Seleziona un file CSV' });
    const parsed = csvService.parseCsv(req.file.buffer);
    const phoneColumn = req.body.phoneColumn || parsed.suggestedPhoneColumn;
    const prepared = phoneColumn
      ? csvService.prepareContacts(parsed, phoneColumn)
      : { contacts: [], invalid: [], duplicates: [] };
    res.json({
      filename: req.file.originalname,
      delimiter: parsed.delimiter,
      headers: parsed.headers,
      suggestedPhoneColumn: parsed.suggestedPhoneColumn,
      totalRows: parsed.rows.length,
      validCount: prepared.contacts.length,
      invalidCount: prepared.invalid.length,
      duplicateCount: prepared.duplicates.length,
      preview: parsed.rows.slice(0, 8),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

async function createCampaign(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Seleziona un file CSV' });
    const botId = req.body.botId;
    const { templateSid, templateName, phoneColumn } = req.body;
    if (!botId || !templateSid || !phoneColumn) {
      return res.status(400).json({ error: 'BOT, template e colonna telefono sono obbligatori' });
    }
    if (!/^HX[a-fA-F0-9]{32}$/.test(templateSid)) {
      return res.status(400).json({ error: 'Il Content SID Twilio non è valido' });
    }
    const bot = await botRepo.getById(botId);
    if (!bot) return res.status(404).json({ error: 'BOT non trovato' });
    if (!bot.active) return res.status(409).json({ error: 'Il BOT selezionato non è attivo' });

    const parsed = csvService.parseCsv(req.file.buffer);
    const variableMapping = parseMapping(req.body.variableMapping);
    const prepared = csvService.prepareContacts(parsed, phoneColumn, variableMapping);
    if (!prepared.contacts.length) {
      return res.status(400).json({ error: 'Il CSV non contiene numeri di telefono validi' });
    }

    const campaign = await broadcastRepo.createCampaign({
      botId: botId,
      templateSid,
      templateName,
      sourceFilename: req.file.originalname,
      phoneColumn,
      variableMapping,
      createdBy: req.user.username,
    }, prepared.contacts);

    broadcastService.enqueue(campaign.id);
    res.status(202).json({
      campaign,
      accepted: prepared.contacts.length,
      invalid: prepared.invalid.length,
      duplicates: prepared.duplicates.length,
    });
  } catch (error) {
    console.error('[broadcast] create error:', error);
    res.status(400).json({ error: error.message });
  }
}

async function listCampaigns(_req, res) {
  res.json({ campaigns: await broadcastRepo.listCampaigns() });
}

async function getCampaign(req, res) {
  const campaign = await broadcastRepo.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Broadcast non trovato' });
  const recipients = await broadcastRepo.listRecipients(campaign.id);
  res.json({ campaign, recipients });
}

module.exports = { listTemplates, previewCsv, createCampaign, listCampaigns, getCampaign };
