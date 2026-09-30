const express = require('express');
const multer = require('multer');
const { requirePermission, requireAdmin } = require('../middleware/auth');
const controller = require('../controllers/crmController');

const router = express.Router();
const read = requirePermission('crm:read');
const write = requirePermission('crm:write');
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.get('/summary', read, handle(controller.getSummary));
router.get('/contacts', read, handle(controller.listContacts));
router.get('/contacts/export', read, handle(controller.exportContacts));
router.post('/contacts', write, handle(controller.createContact));
router.patch('/contacts/bulk', write, handle(controller.bulkUpdateContacts));
router.post('/contacts/import/preview', write, csvUpload.single('contacts'), handle(controller.previewContactImport));
router.post('/contacts/import', write, csvUpload.single('contacts'), handle(controller.importContacts));
router.get('/contacts/:id/profile', read, handle(controller.getContactProfile));
router.patch('/contacts/:id', write, handle(controller.updateContact));
router.delete('/contacts/:id', write, handle(controller.deleteContact));

router.get('/lists', read, handle(controller.listLists));
router.post('/lists', write, handle(controller.createList));
router.put('/lists/:id', write, handle(controller.updateList));
router.get('/lists/:id/contacts', read, handle(controller.listContactsInList));
router.get('/lists/:id/export', read, handle(controller.exportContactsInList));
router.delete('/lists/:id', write, handle(controller.deleteList));

router.get('/templates', read, handle(controller.listTemplates));
router.post('/templates', write, handle(controller.createTemplate));
router.post('/templates/test', write, handle(controller.sendTemplateTest));
router.put('/templates/:id', write, handle(controller.updateTemplate));
router.delete('/templates/:id', write, handle(controller.deleteTemplate));

router.get('/sequences', read, handle(controller.listSequences));
router.get('/sequences/:id/enrollments', read, handle(controller.listSequenceEnrollments));
router.post('/sequences', write, handle(controller.createSequence));
router.put('/sequences/:id', write, handle(controller.updateSequence));
router.patch('/sequences/:id/status', write, handle(controller.updateSequenceStatus));
router.patch('/sequences/:id/enrollments/:enrollmentId/status', write, handle(controller.updateEnrollmentStatus));
router.post('/sequences/:id/enroll', write, handle(controller.enrollList));
router.delete('/sequences/:id', write, handle(controller.deleteSequence));

router.get('/campaigns', read, handle(controller.listCampaigns));
router.get('/campaigns/:id/jobs', read, handle(controller.listCampaignJobs));
router.post('/campaigns', write, handle(controller.createCampaign));

router.get('/sender', requireAdmin, handle(controller.getSender));
router.put('/sender', requireAdmin, handle(controller.updateSender));
router.post('/sender/test', requireAdmin, handle(controller.testSender));
router.post('/process', requireAdmin, handle(controller.processEmails));
router.get('/api-keys', requireAdmin, handle(controller.listApiKeys));
router.post('/api-keys', requireAdmin, handle(controller.createApiKey));
router.post('/api-keys/:id/rotate', requireAdmin, handle(controller.rotateApiKey));
router.delete('/api-keys/:id', requireAdmin, handle(controller.revokeApiKey));

router.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Il file CSV supera il limite di 5 MB' });
  }
  return next(error);
});

module.exports = router;
