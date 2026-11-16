const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { login, me, logout, changeForcedPassword } = require('../controllers/authController');
const authenticateToken = require('../middleware/authenticate');

const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 10,
	message: { success: false, message: 'Too many login attempts, please try again later' },
});
const loginLimiter = (typeof limiter === 'function') ? limiter : ((req, res, next) => next());

router.post('/login', loginLimiter, login);
router.post('/logout', authenticateToken, logout);
router.post('/change-password', authenticateToken, changeForcedPassword);
router.get('/me', authenticateToken, me);

module.exports = router;
