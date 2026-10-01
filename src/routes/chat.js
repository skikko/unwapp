const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/auth');
const ctrl = require('../controllers/chatController');

router.get('/conversations', requirePermission('chat:read'), ctrl.listConversations);
router.get('/conversations/:id', requirePermission('chat:read'), ctrl.getConversation);
router.post('/conversations/:id/send', requirePermission('chat:write'), ctrl.sendOperatorMessage);
router.patch('/conversations/:id/release', requirePermission('chat:write'), ctrl.releaseOperator);
router.patch('/conversations/:id/close', requirePermission('chat:write'), ctrl.closeConversation);
router.patch('/conversations/:id/archive', requirePermission('chat:write'), ctrl.archiveConversation);
router.patch('/conversations/:id/read-state', requirePermission('chat:write'), ctrl.updateReadState);
router.delete('/conversations/:id', requirePermission('admin'), ctrl.deleteConversation);
router.delete('/conversations/:id/messages/:messageId', requirePermission('admin'), ctrl.deleteMessage);

module.exports = router;
