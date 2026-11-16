const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authenticateToken = require('../middleware/authenticate');
const authorizeRole = require('../middleware/authorize');
const {
  updateAdminSettings,
  getAccountSettings,
  saveAccountPreferences,
  changeAccountPassword,
  revokeAllSessions,
  exportLoginHistory,
} = require('../controllers/adminSettingsController');
const { uploadProfilePhoto } = require('../middleware/profilePhotoUpload');
const { uploadUserPhoto, deleteUserPhoto } = require('../controllers/profilePhotoController');

const reauthenticationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification attempts. Please try again later.' },
});
const limitSensitiveSettingsChange = (req, res, next) => (
  req.body?.current_password ? reauthenticationLimiter(req, res, next) : next()
);

router.put('/', authenticateToken, authorizeRole(['admin', 'bhw', 'official']), limitSensitiveSettingsChange, updateAdminSettings);
router.get('/account', authenticateToken, authorizeRole(['admin', 'bhw', 'official']), getAccountSettings);
router.put('/preferences', authenticateToken, authorizeRole(['admin', 'bhw', 'official']), saveAccountPreferences);
router.post('/password', authenticateToken, authorizeRole(['admin', 'bhw', 'official']), reauthenticationLimiter, changeAccountPassword);
router.post('/sessions/revoke-all', authenticateToken, authorizeRole(['admin', 'bhw', 'official']), reauthenticationLimiter, revokeAllSessions);
router.get('/activity.csv', authenticateToken, authorizeRole(['admin', 'bhw', 'official']), exportLoginHistory);
router.post('/profile-photo', authenticateToken, authorizeRole(['admin', 'bhw', 'official']), uploadProfilePhoto, uploadUserPhoto);
router.delete('/profile-photo', authenticateToken, authorizeRole(['admin', 'bhw', 'official']), deleteUserPhoto);

module.exports = router;
