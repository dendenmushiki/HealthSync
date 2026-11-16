const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { login, me, logout, changeForcedPassword } = require('../controllers/authController');
const {
  completePinSetup,
  savePin,
  verifyCurrentPassword,
  getDevices,
  revokeOwnDevice,
  checkDeviceStatus,
} = require('../controllers/offlineSecurityController');
const authenticateToken = require('../middleware/authenticate');

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 10,
	message: { success: false, message: 'Too many login attempts, please try again later' },
});
const loginLimiter = (typeof limiter === 'function') ? limiter : ((req, res, next) => next());
const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many PIN enrollment attempts. Try again later.' },
});
const deviceStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many device authorization checks. Try again later.' },
});

router.post('/login', loginLimiter, login);
router.post('/offline-status', deviceStatusLimiter, checkDeviceStatus);
router.post('/logout', authenticateToken, logout);
router.post('/change-password', authenticateToken, changeForcedPassword);
router.post('/complete-offline-setup', authenticateToken, pinLimiter, completePinSetup);
router.post('/offline-pin', authenticateToken, pinLimiter, savePin);
router.post('/offline-pin/verify-password', authenticateToken, pinLimiter, verifyCurrentPassword);
router.get('/devices', authenticateToken, getDevices);
router.post('/devices/:deviceId/revoke', authenticateToken, pinLimiter, revokeOwnDevice);
router.get('/me', authenticateToken, me);

module.exports = router;
