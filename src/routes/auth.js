const express = require('express');
const ctrl = require('../controllers/authController');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const router = express.Router();
router.post('/login', ctrl.login);
router.post('/logout', requireAuth, ctrl.logout);
router.get('/users', requireAdmin, ctrl.listUsers);
router.post('/users', requireAdmin, ctrl.createUser);
router.patch('/users/:id', requireAdmin, ctrl.updateUser);
router.delete('/users/:id', requireAdmin, ctrl.deleteUser);

module.exports = router;
