const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const pool = require('../config/database');
const { ensureUserStatusColumn } = require('../controllers/userController');
const { ensureAccountSecuritySchema } = require('../services/accountSecurityService');
const { ensureUserManagementSchema } = require('../services/userManagementService');
const { ensureOfflineSecuritySchema } = require('../services/offlineSecurityService');

dotenv.config();

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ success: false, message: 'Missing token' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      user_id: payload.user_id,
      username: payload.username,
      role: payload.role,
      jti: payload.jti || null,
      device_id: payload.device_id || null,
    };

    await ensureUserStatusColumn();
    await ensureAccountSecuritySchema();
    await ensureUserManagementSchema();
    await ensureOfflineSecuritySchema();

    const [rows] = await pool.query('SELECT user_id, username, role, is_active, token_version, must_change_password, offline_pin_setup_required FROM users WHERE user_id = ?', [payload.user_id]);
    if (!rows || rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    if (rows[0].is_active === false || Number(rows[0].is_active) === 0) {
      return res.status(403).json({ success: false, message: 'Account is deactivated', errorCode: 'ACCOUNT_DEACTIVATED' });
    }

    if (Number(payload.token_version || 0) !== Number(rows[0].token_version || 0)) {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }

    req.user.must_change_password = Boolean(rows[0].must_change_password);
    req.user.offline_pin_setup_required = Boolean(rows[0].offline_pin_setup_required);
    const passwordChangeAllowed = req.baseUrl === '/api/auth'
      && ['/change-password', '/complete-offline-setup', '/logout'].includes(req.path);
    if (req.user.must_change_password && !passwordChangeAllowed) {
      return res.status(403).json({
        success: false,
        message: 'Set a new password before using HealthSync.',
        errorCode: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    const pinSetupAllowed = req.baseUrl === '/api/auth'
      && ['/complete-offline-setup', '/logout'].includes(req.path);
    const forcedPasswordStep = req.user.must_change_password && req.baseUrl === '/api/auth' && req.path === '/change-password';
    if (req.user.offline_pin_setup_required && !pinSetupAllowed && !forcedPasswordStep) {
      return res.status(403).json({
        success: false,
        message: 'Complete PIN setup before using HealthSync.',
        errorCode: 'OFFLINE_PIN_SETUP_REQUIRED',
      });
    }

    if (!payload.device_id) {
      return res.status(401).json({ success: false, message: 'Device registration is required. Sign in again.', errorCode: 'DEVICE_REGISTRATION_REQUIRED' });
    }
    const [devices] = await pool.query(
      "SELECT device_id FROM offline_devices WHERE device_id = ? AND user_id = ? AND status = 'ACTIVE' LIMIT 1",
      [payload.device_id, payload.user_id]
    );
    if (!devices.length) {
      return res.status(403).json({ success: false, message: 'This device is not authorized.', errorCode: 'DEVICE_REVOKED' });
    }

    if (payload.jti) {
      const [sessions] = await pool.query(
        "SELECT id FROM user_login_history WHERE session_id = ? AND user_id = ? AND status = 'ACTIVE' LIMIT 1",
        [payload.jti, payload.user_id]
      );
      if (!sessions.length) {
        return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
      }
    }

    next();
  } catch (err) {
    if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(err.name)) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
    const logger = require('../services/logger');
    logger.error('Authentication verification error', err);
    return res.status(500).json({ success: false, message: 'Unable to verify the current session.' });
  }
};

module.exports = authenticateToken;
