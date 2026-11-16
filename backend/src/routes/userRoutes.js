const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const {
  listUsers,
  getUser,
  checkUsername,
  createUser,
  updateUser,
  updateUserStatus,
  deactivateUser,
  reactivateUser,
  resetUserPassword,
  unlockUser,
  logoutAllUserSessions,
} = require('../controllers/userController');

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many reset attempts. Try again later.' },
});

router.get('/', authenticateToken, authorizeRole(['admin']), listUsers);
router.get('/check-username', authenticateToken, authorizeRole(['admin']), checkUsername);
router.post('/', authenticateToken, authorizeRole(['admin']), createUser);
router.post('/:id/reset-password', authenticateToken, authorizeRole(['admin']), resetPasswordLimiter, resetUserPassword);
router.post('/:id/deactivate', authenticateToken, authorizeRole(['admin']), deactivateUser);
router.post('/:id/reactivate', authenticateToken, authorizeRole(['admin']), reactivateUser);
router.post('/:id/unlock', authenticateToken, authorizeRole(['admin']), unlockUser);
router.post('/:id/logout-all', authenticateToken, authorizeRole(['admin']), logoutAllUserSessions);
router.put('/:id', authenticateToken, authorizeRole(['admin']), updateUser);
router.patch('/:id/status', authenticateToken, authorizeRole(['admin']), updateUserStatus);
router.get('/:id', authenticateToken, authorizeRole(['admin']), getUser);

module.exports = router;
