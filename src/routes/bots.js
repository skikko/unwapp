const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/auth');
const ctrl = require('../controllers/botController');

router.get('/', requirePermission('bots:read'), ctrl.list);
router.post('/', requirePermission('admin'), ctrl.create);
router.get('/:id', requirePermission('bots:read'), ctrl.getOne);
router.put('/:id', requirePermission('admin'), ctrl.update);
router.patch('/:id', requirePermission('admin'), ctrl.update);
router.delete('/:id', requirePermission('admin'), ctrl.remove);

module.exports = router;
