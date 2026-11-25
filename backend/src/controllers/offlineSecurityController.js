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

const setCurrentDevicePinVersion = async ({
  connection,
  userId,
  currentDeviceId,
  pinVersion,
  invalidateOtherDevices,
}) => {
  const [devices] = await connection.query(
    'SELECT device_id, status FROM offline_devices WHERE user_id = ? FOR UPDATE',
    [userId]
  );
  const currentDevice = devices.find((device) => device.device_id === currentDeviceId);
  if (!currentDevice || currentDevice.status !== 'ACTIVE') {
    throw new Error('The active device registration could not be updated.');
  }
  if (invalidateOtherDevices) {
    await connection.query(
      'UPDATE offline_devices SET pin_version = 0 WHERE user_id = ? AND device_id <> ?',
      [userId, currentDeviceId]
    );
  }
  await connection.query(
    "UPDATE offline_devices SET pin_version = ? WHERE user_id = ? AND device_id = ? AND status = 'ACTIVE'",
    [pinVersion, userId, currentDeviceId]
  );
};

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
    return res.json({
      success: true,
      data: {
        authorized: true,
        pinEnrolled: result.pinEnrolled,
        accountPinEnrolled: result.accountPinEnrolled,
      },
    });
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
    const currentPin = isPin(req.body?.current_pin) ? req.body.current_pin : '';
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    if (!isPin(pin)) return res.status(400).json({ success: false, message: 'PIN must contain exactly six digits.' });
    if (!req.user.offline_pin_setup_required) {
      const [rows] = await pool.query(
        `SELECT u.offline_pin_hash, u.offline_pin_version, d.status
         FROM users u JOIN offline_devices d ON d.user_id = u.user_id
         WHERE d.device_id = ? AND u.user_id = ? LIMIT 1`,
        [req.user.device_id, req.user.user_id]
      );
      if (rows[0]?.status === 'ACTIVE' && rows[0].offline_pin_hash &&
          await bcrypt.compare(pin, rows[0].offline_pin_hash)) {
        await pool.query(
          "UPDATE offline_devices SET pin_version = ? WHERE device_id = ? AND user_id = ? AND status = 'ACTIVE'",
          [rows[0].offline_pin_version, req.user.device_id, req.user.user_id]
        );
        return res.json({ success: true, message: 'PIN setup completed.' });
      }
      return res.status(409).json({ success: false, message: 'PIN setup is not pending for this account.' });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [accountRows] = await connection.query(
        'SELECT password, offline_pin_hash, offline_pin_version FROM users WHERE user_id = ? FOR UPDATE',
        [req.user.user_id]
      );
      if (!accountRows.length) throw new Error('The account could not be found while setting up its PIN.');
      const [deviceRows] = await connection.query(
        'SELECT pin_hash, status FROM offline_devices WHERE device_id = ? AND user_id = ? LIMIT 1',
        [req.user.device_id, req.user.user_id]
      );
      if (!deviceRows.length || deviceRows[0].status !== 'ACTIVE') {
        await connection.rollback();
        return res.status(403).json({ success: false, message: 'This device is not authorized.' });
      }

      const currentAccountPinHash = accountRows[0].offline_pin_hash;
      const currentDevicePinHash = deviceRows[0].pin_hash;
      const hasExistingPin = Boolean(currentAccountPinHash || currentDevicePinHash);
      if (hasExistingPin) {
        const accountPinMatches = Boolean(currentAccountPinHash) &&
          await bcrypt.compare(pin, currentAccountPinHash);
        const devicePinMatches = !currentAccountPinHash && Boolean(currentDevicePinHash) &&
          await bcrypt.compare(pin, currentDevicePinHash);
        const isResetRequired = Boolean(req.user.offline_pin_setup_required && currentAccountPinHash &&
          (currentPin || currentPassword));

        if (req.user.offline_pin_setup_required && currentAccountPinHash && !isResetRequired) {
          await connection.rollback();
          return res.status(401).json({ success: false, message: 'Enter your current PIN or account password to protect existing offline data.' });
        }

        if (isResetRequired) {
          const currentPinMatchesAccount = Boolean(currentPin && currentAccountPinHash) &&
            await bcrypt.compare(currentPin, currentAccountPinHash);
          const currentPinMatchesDevice = Boolean(currentPin && currentDevicePinHash) &&
            await bcrypt.compare(currentPin, currentDevicePinHash);
          const currentPasswordMatches = Boolean(currentPassword) &&
            await bcrypt.compare(currentPassword, accountRows[0].password);
          if (!currentPinMatchesAccount && !currentPinMatchesDevice && !currentPasswordMatches) {
            await connection.rollback();
            return res.status(401).json({ success: false, message: 'The current PIN or account password is incorrect.' });
          }
          if (accountPinMatches || devicePinMatches ||
              (currentDevicePinHash && await bcrypt.compare(pin, currentDevicePinHash))) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Choose a PIN different from the existing offline PIN.' });
          }
          const currentVersion = Number(accountRows[0].offline_pin_version || 0);
          const pinVersion = Math.max(1, currentVersion + 1);
          const accountPinHash = await bcrypt.hash(pin, 12);
          await connection.query(
            `UPDATE users SET offline_pin_setup_required = 0, offline_pin_hash = ?, offline_pin_version = ?
             WHERE user_id = ? AND offline_pin_setup_required = 1`,
            [accountPinHash, pinVersion, req.user.user_id]
          );
          await setCurrentDevicePinVersion({
            connection,
            userId: req.user.user_id,
            currentDeviceId: req.user.device_id,
            pinVersion,
            invalidateOtherDevices: true,
          });
          await connection.commit();
          await writeAudit({
            user_id: req.user.user_id,
            action: 'OFFLINE_PIN_RESET',
            module: 'auth',
            description: 'Offline PIN reset completed.',
            targetType: 'user',
            targetId: req.user.user_id,
            result: 'success',
            req,
          });
          return res.json({ success: true, message: 'Offline PIN reset completed.' });
        }

        if (currentAccountPinHash && !accountPinMatches) {
          await connection.rollback();
          return res.status(409).json({ success: false, message: 'Use the existing account PIN on this device.' });
        }
        if (!currentAccountPinHash && currentDevicePinHash && !devicePinMatches) {
          await connection.rollback();
          return res.status(409).json({ success: false, message: 'Use this device’s existing PIN to preserve its offline data.' });
        }
      }

      if (!hasExistingPin && (currentPin || currentPassword)) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'No existing offline PIN is available to reset.' });
      }

      const accountPinMatches = Boolean(currentAccountPinHash) &&
        await bcrypt.compare(pin, currentAccountPinHash);
      const currentVersion = Number(accountRows[0].offline_pin_version || 0);
      const pinVersion = accountPinMatches ? Math.max(1, currentVersion) : Math.max(1, currentVersion + 1);
      const accountPinHash = accountPinMatches ? currentAccountPinHash : await bcrypt.hash(pin, 12);
      const [result] = await connection.query(
        `UPDATE users SET offline_pin_setup_required = 0, offline_pin_hash = ?, offline_pin_version = ?
         WHERE user_id = ? AND offline_pin_setup_required = 1`,
        [accountPinHash, pinVersion, req.user.user_id]
      );
      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(409).json({ success: false, message: 'PIN setup has already been completed.' });
      }
      await setCurrentDevicePinVersion({
        connection,
        userId: req.user.user_id,
        currentDeviceId: req.user.device_id,
        pinVersion,
        invalidateOtherDevices: !accountPinMatches || currentVersion === 0,
      });
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

const verifyPin = async (req, res) => {
  try {
    await ensureOfflineSecuritySchema();
    const { current_password: password, pin, scope } = req.body || {};
    if (!password || !isPin(pin) || !['account', 'device', 'promote'].includes(scope)) {
      return res.status(400).json({ success: false, message: 'Enter your account password, six-digit PIN, and a valid PIN action.' });
    }
    const [users] = await pool.query(
      'SELECT password, offline_pin_hash FROM users WHERE user_id = ? LIMIT 1',
      [req.user.user_id]
    );
    if (!users.length || !(await bcrypt.compare(password, users[0].password))) {
      return res.status(401).json({ success: false, message: 'The current account password is incorrect.' });
    }
    if (scope === 'device') {
      if (!users[0].offline_pin_hash || !(await bcrypt.compare(pin, users[0].offline_pin_hash))) {
        return res.status(401).json({ success: false, message: 'Enter the account’s current shared PIN to set up this device.' });
      }
    } else if (scope === 'promote') {
      if (users[0].offline_pin_hash) {
        return res.status(409).json({ success: false, message: 'A shared account PIN already exists. Use that PIN on this device.' });
      }
      const [devices] = await pool.query(
        "SELECT pin_hash FROM offline_devices WHERE device_id = ? AND user_id = ? AND status = 'ACTIVE' LIMIT 1",
        [req.user.device_id, req.user.user_id]
      );
      if (!devices.length || !devices[0].pin_hash || !(await bcrypt.compare(pin, devices[0].pin_hash))) {
        return res.status(401).json({ success: false, message: 'Enter this device’s existing PIN to make it the shared account PIN.' });
      }
    }
    return res.json({ success: true, message: 'PIN verified.' });
  } catch (error) {
    const logger = require('../services/logger');
    logger.error('verifyPin error', error);
    return res.status(500).json({ success: false, message: 'Unable to verify the PIN.' });
  }
};

const savePin = async (req, res) => {
  try {
    await ensureOfflineSecuritySchema();
    const { current_password: password, pin, scope = 'account' } = req.body || {};
    if (!password || !isPin(pin)) {
      return res.status(400).json({ success: false, message: 'Enter your current password and a six-digit PIN.' });
    }
    if (!['account', 'device'].includes(scope)) {
      return res.status(400).json({ success: false, message: 'Choose whether to set the account PIN or enroll this device.' });
    }
    if (req.user.must_change_password || req.user.offline_pin_setup_required) {
      return res.status(403).json({ success: false, message: 'Complete required account setup before changing the PIN.' });
    }
    const [rows] = await pool.query(
      'SELECT password, offline_pin_hash, offline_pin_version FROM users WHERE user_id = ? LIMIT 1',
      [req.user.user_id]
    );
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password))) {
      return res.status(401).json({ success: false, message: 'The current account password is incorrect.' });
    }
    if (scope === 'device') {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [accountRows] = await connection.query(
          'SELECT offline_pin_hash, offline_pin_version FROM users WHERE user_id = ? FOR UPDATE',
          [req.user.user_id]
        );
        if (!accountRows.length || !accountRows[0].offline_pin_hash ||
            !(await bcrypt.compare(pin, accountRows[0].offline_pin_hash))) {
          await connection.rollback();
          return res.status(401).json({ success: false, message: 'Enter the account’s current shared PIN to set up this device.' });
        }
        const currentVersion = Number(accountRows[0].offline_pin_version || 0);
        const pinVersion = Math.max(1, currentVersion);
        if (currentVersion === 0) {
          await connection.query(
            'UPDATE users SET offline_pin_version = ? WHERE user_id = ?',
            [pinVersion, req.user.user_id]
          );
        }
        await setCurrentDevicePinVersion({
          connection,
          userId: req.user.user_id,
          currentDeviceId: req.user.device_id,
          pinVersion,
          invalidateOtherDevices: currentVersion === 0,
        });
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } else {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [accountRows] = await connection.query(
          'SELECT offline_pin_hash, offline_pin_version FROM users WHERE user_id = ? FOR UPDATE',
          [req.user.user_id]
        );
        if (!accountRows.length) throw new Error('The account could not be found while updating its PIN.');
        const [currentDevices] = await connection.query(
          'SELECT pin_hash, status FROM offline_devices WHERE device_id = ? AND user_id = ? LIMIT 1',
          [req.user.device_id, req.user.user_id]
        );
        if (!currentDevices.length || currentDevices[0].status !== 'ACTIVE') {
          await connection.rollback();
          return res.status(403).json({ success: false, message: 'This device is not authorized.' });
        }
        if (!accountRows[0].offline_pin_hash && currentDevices[0].pin_hash &&
            !await bcrypt.compare(pin, currentDevices[0].pin_hash)) {
          await connection.rollback();
          return res.status(409).json({ success: false, message: 'Use this device’s current PIN to make it the shared account PIN.' });
        }
        const currentVersion = Number(accountRows[0].offline_pin_version || 0);
        const accountPinMatches = Boolean(accountRows[0].offline_pin_hash) &&
          await bcrypt.compare(pin, accountRows[0].offline_pin_hash);
        const pinVersion = accountPinMatches
          ? Math.max(1, currentVersion)
          : Math.max(1, currentVersion + 1);
        const invalidateOtherDevices = !accountPinMatches || currentVersion === 0;
        if (invalidateOtherDevices) {
          const hash = await bcrypt.hash(pin, 12);
          await connection.query(
            'UPDATE users SET offline_pin_hash = ?, offline_pin_version = ? WHERE user_id = ?',
            [hash, pinVersion, req.user.user_id]
          );
        }
        await setCurrentDevicePinVersion({
          connection,
          userId: req.user.user_id,
          currentDeviceId: req.user.device_id,
          pinVersion,
          invalidateOtherDevices,
        });
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }
    await writeAudit({
      user_id: req.user.user_id,
      action: scope === 'device' ? 'OFFLINE_PIN_DEVICE_ENROLLED' : 'OFFLINE_PIN_CHANGED',
      module: 'auth',
      description: scope === 'device'
        ? 'This device was enrolled with the shared account PIN.'
        : 'The shared account PIN was enrolled or changed.',
      targetType: 'user',
      targetId: req.user.user_id,
      result: 'success',
      req,
    });
    return res.json({
      success: true,
      message: scope === 'device' ? 'This device now uses the shared account PIN.' : 'Shared account PIN saved successfully.',
    });
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

const adminResetUserPin = async (req, res) => {
  const { id } = req.params;
  const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
  if (!/^\d+$/.test(String(id || '')) || Number(id) <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid user ID.' });
  }
  if (Number(id) === Number(req.user.user_id)) {
    return res.status(403).json({ success: false, message: 'You cannot reset your own offline PIN here.' });
  }
  if (!currentPassword) {
    return res.status(400).json({ success: false, message: 'Enter your current account password to reset this PIN.' });
  }

  const connection = await pool.getConnection();
  try {
    await ensureOfflineSecuritySchema();
    await connection.beginTransaction();
    const [adminRows] = await connection.query('SELECT password FROM users WHERE user_id = ? FOR UPDATE', [req.user.user_id]);
    if (!adminRows.length || !(await bcrypt.compare(currentPassword, adminRows[0].password))) {
      await connection.rollback();
      return res.status(401).json({ success: false, message: 'The current account password is incorrect.' });
    }

    const [rows] = await connection.query(
      `SELECT user_id, username, must_change_password, offline_pin_setup_required, offline_pin_hash
       FROM users WHERE user_id = ? FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const target = rows[0];
    if (String(target.username).trim().toLowerCase() === 'hsync_admin') {
      await connection.rollback();
      return res.status(403).json({ success: false, message: 'The primary admin account is managed through its own Settings page.' });
    }
    if (target.must_change_password) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'Complete the required password setup before resetting the offline PIN.' });
    }
    if (target.offline_pin_setup_required) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'An offline PIN reset is already pending for this user.' });
    }
    if (!target.offline_pin_hash) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'This user has not set up a shared offline PIN.' });
    }

    await connection.query(
      `UPDATE users SET offline_pin_setup_required = 1, token_version = token_version + 1,
        updated_at = UTC_TIMESTAMP() WHERE user_id = ?`,
      [id]
    );
    await connection.query(
      "UPDATE user_login_history SET status = 'REVOKED', ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'ACTIVE'",
      [id]
    );
    await connection.commit();
    await writeAudit({
      user_id: req.user.user_id,
      action: 'OFFLINE_PIN_RESET_REQUIRED',
      module: 'users',
      description: 'Required the user to reset their offline PIN.',
      table_name: 'users',
      record_id: id,
      targetType: 'user',
      targetId: id,
      result: 'success',
      req,
    });
    return res.json({
      success: true,
      message: 'Offline PIN reset required. The user must sign in and set a new PIN.',
    });
  } catch (error) {
    await connection.rollback();
    const logger = require('../services/logger');
    logger.error('adminResetUserPin error', error);
    return res.status(500).json({ success: false, message: 'Unable to reset the offline PIN.' });
  } finally {
    connection.release();
  }
};

module.exports = {
  checkDeviceStatus,
  completePinSetup,
  verifyPin,
  savePin,
  verifyCurrentPassword,
  getDevices,
  getUserDevices,
  revokeOwnDevice,
  adminManageDevice,
  adminResetUserPin,
};
