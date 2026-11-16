const bcrypt = require('bcrypt');
const pool = require('../config/database');
const { writeAudit } = require('../services/auditService');
const {
  approveUserDevice,
  checkDeviceAuthorization,
  ensureOfflineSecuritySchema,
  listUserDevices,
  revokeUserDevice,
} = require('../services/offlineSecurityService');

const isPin = (pin) => typeof pin === 'string' && /^\d{6}$/.test(pin);

const checkDeviceStatus = async (req, res) => {
  try {
    const userId = req.body?.user_id;
    const result = await checkDeviceAuthorization({
      userId,
      deviceId: req.body?.device_id,
      message: req.body?.challenge,
      signature: req.body?.signature,
    });
    if (!result.ok) {
      const message = result.code === 'ACCOUNT_DEACTIVATED'
        ? 'Account is deactivated.'
        : 'This device is not authorized.';
      return res.status(403).json({ success: false, message, errorCode: result.code });
    }
    return res.json({ success: true, data: { authorized: true } });
  } catch (error) {
    const logger = require('../services/logger');
    logger.error('checkDeviceStatus error', error);
    return res.status(500).json({ success: false, message: 'Unable to verify device authorization.' });
  }
};

const completePinSetup = async (req, res) => {
  try {
    await ensureOfflineSecuritySchema();
    const pin = req.body?.pin;
    if (!isPin(pin)) return res.status(400).json({ success: false, message: 'PIN must contain exactly six digits.' });
    if (!req.user.offline_pin_setup_required) {
      const [rows] = await pool.query('SELECT pin_hash FROM offline_devices WHERE device_id = ? AND user_id = ? LIMIT 1', [req.user.device_id, req.user.user_id]);
      if (rows[0]?.pin_hash && await bcrypt.compare(pin, rows[0].pin_hash)) {
        return res.json({ success: true, message: 'PIN setup completed.' });
      }
      return res.status(409).json({ success: false, message: 'PIN setup is not pending for this account.' });
    }
    const hash = await bcrypt.hash(pin, 12);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(
        'UPDATE users SET offline_pin_setup_required = 0 WHERE user_id = ? AND offline_pin_setup_required = 1',
        [req.user.user_id]
      );
      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(409).json({ success: false, message: 'PIN setup has already been completed.' });
      }
      const [deviceResult] = await connection.query(
        "UPDATE offline_devices SET pin_hash = ? WHERE device_id = ? AND user_id = ? AND status = 'ACTIVE'",
        [hash, req.user.device_id, req.user.user_id]
      );
      if (!deviceResult.affectedRows) throw new Error('The active device registration could not be updated.');
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeAudit({
      user_id: req.user.user_id,
      action: 'OFFLINE_PIN_ENROLLED',
      module: 'auth',
      description: 'Offline PIN enrolled.',
      targetType: 'user',
      targetId: req.user.user_id,
      result: 'success',
      req,
    });
    return res.json({ success: true, message: 'PIN setup completed.' });
  } catch (error) {
    const logger = require('../services/logger');
    logger.error('completePinSetup error', error);
    return res.status(500).json({ success: false, message: 'Unable to complete PIN setup.' });
  }
};

const savePin = async (req, res) => {
  try {
    await ensureOfflineSecuritySchema();
    const { current_password: password, pin } = req.body || {};
    if (!password || !isPin(pin)) {
      return res.status(400).json({ success: false, message: 'Enter your current password and a six-digit PIN.' });
    }
    if (req.user.must_change_password || req.user.offline_pin_setup_required) {
      return res.status(403).json({ success: false, message: 'Complete required account setup before changing the PIN.' });
    }
    const [rows] = await pool.query(
      'SELECT password FROM users WHERE user_id = ? LIMIT 1',
      [req.user.user_id]
    );
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password))) {
      return res.status(401).json({ success: false, message: 'The current account password is incorrect.' });
    }
    const hash = await bcrypt.hash(pin, 12);
    const [result] = await pool.query(
      "UPDATE offline_devices SET pin_hash = ? WHERE device_id = ? AND user_id = ? AND status = 'ACTIVE'",
      [hash, req.user.device_id, req.user.user_id]
    );
    if (!result.affectedRows) return res.status(403).json({ success: false, message: 'This device is not authorized.' });
    await writeAudit({
      user_id: req.user.user_id,
      action: 'OFFLINE_PIN_CHANGED',
      module: 'auth',
      description: 'Offline PIN enrolled or changed.',
      targetType: 'user',
      targetId: req.user.user_id,
      result: 'success',
      req,
    });
    return res.json({ success: true, message: 'PIN saved successfully.' });
  } catch (error) {
    const logger = require('../services/logger');
    logger.error('savePin error', error);
    return res.status(500).json({ success: false, message: 'Unable to save the PIN.' });
  }
};

const verifyCurrentPassword = async (req, res) => {
  try {
    const password = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    if (!password) return res.status(400).json({ success: false, message: 'Current password is required.' });
    const [rows] = await pool.query('SELECT password FROM users WHERE user_id = ? LIMIT 1', [req.user.user_id]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password))) {
      return res.status(401).json({ success: false, message: 'The current account password is incorrect.' });
    }
    return res.json({ success: true, message: 'Password verified.' });
  } catch (error) {
    const logger = require('../services/logger');
    logger.error('verifyCurrentPassword error', error);
    return res.status(500).json({ success: false, message: 'Unable to verify the current password.' });
  }
};

const getDevices = async (req, res) => {
  try {
    const devices = await listUserDevices(req.user.user_id);
    return res.json({ success: true, data: devices.map(({ device_id, status, created_at, last_seen_at, revoked_at }) => ({
      device_id,
      status,
      created_at,
      last_seen_at,
      revoked_at,
      current: device_id === req.user.device_id,
    })) });
  } catch (error) {
    const logger = require('../services/logger');
    logger.error('getOfflineDevices error', error);
    return res.status(500).json({ success: false, message: 'Unable to load authorized devices.' });
  }
};

const getUserDevices = async (req, res) => {
  try {
    const devices = await listUserDevices(req.params.userId);
    return res.json({ success: true, data: devices });
  } catch (error) {
    const logger = require('../services/logger');
    logger.error('getUserOfflineDevices error', error);
    return res.status(500).json({ success: false, message: 'Unable to load authorized devices.' });
  }
};

const revokeOwnDevice = async (req, res) => {
  try {
    const { current_password: password } = req.body || {};
    if (!password) return res.status(400).json({ success: false, message: 'Current password is required.' });
    const [rows] = await pool.query('SELECT password FROM users WHERE user_id = ? LIMIT 1', [req.user.user_id]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password))) {
      return res.status(401).json({ success: false, message: 'The current account password is incorrect.' });
    }
    const revoked = await revokeUserDevice({
      userId: req.user.user_id,
      deviceId: req.params.deviceId,
    });
    if (!revoked) return res.status(404).json({ success: false, message: 'Authorized device was not found.' });
    return res.json({ success: true, message: 'Device authorization revoked.' });
  } catch (error) {
    const logger = require('../services/logger');
    logger.error('revokeOwnDevice error', error);
    return res.status(500).json({ success: false, message: 'Unable to revoke device authorization.' });
  }
};

const adminManageDevice = async (req, res) => {
  try {
    const action = req.params.action;
    if (!['approve', 'revoke'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Unsupported device action.' });
    }
    const changed = action === 'approve'
      ? await approveUserDevice({ userId: req.params.userId, deviceId: req.params.deviceId })
      : await revokeUserDevice({
        userId: req.params.userId,
        deviceId: req.params.deviceId,
        revokedBy: req.user.user_id,
      });
    if (!changed) return res.status(404).json({ success: false, message: 'Device was not found or is already in that state.' });
    return res.json({ success: true, message: action === 'approve' ? 'Device approved.' : 'Device revoked.' });
  } catch (error) {
    const logger = require('../services/logger');
    logger.error('adminManageDevice error', error);
    return res.status(500).json({ success: false, message: 'Unable to update device authorization.' });
  }
};

module.exports = {
  checkDeviceStatus,
  completePinSetup,
  savePin,
  verifyCurrentPassword,
  getDevices,
  getUserDevices,
  revokeOwnDevice,
  adminManageDevice,
};
