const pool = require('../config/database');
const bcrypt = require('bcrypt');
const logger = require('../services/logger');
const { writeAudit } = require('../services/auditService');
const { isStoredProfilePhoto } = require('../middleware/profilePhotoUpload');
const { validatePassword } = require('../services/passwordPolicy');
const { ensureAccountSecuritySchema, readPreferences, defaultPreferences } = require('../services/accountSecurityService');

const ensureUserPhotoColumn = async () => {
  const [columns] = await pool.query("SHOW COLUMNS FROM users LIKE 'profile_photo'");
  if (!columns.length) {
    await pool.query('ALTER TABLE users ADD COLUMN profile_photo VARCHAR(500) NULL');
  }
};

const updateAdminSettings = async (req, res) => {
  try {
    await ensureUserPhotoColumn();
    await ensureAccountSecuritySchema();
    const { full_name, username, current_password, new_password, profile_photo } = req.body;

    const [rows] = await pool.query(
      'SELECT user_id, full_name, username, password, role, profile_photo FROM users WHERE user_id = ? LIMIT 1',
      [req.user.user_id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const current = rows[0];
    if ((username !== undefined && typeof username !== 'string') || (full_name !== undefined && typeof full_name !== 'string')) {
      return res.status(400).json({ success: false, message: 'Full name and username must be text values.' });
    }
    const nextUsername = username !== undefined ? username.trim() : current.username;
    const nextFullName = full_name !== undefined ? full_name.trim() : current.full_name;
    const nextPhoto = profile_photo !== undefined ? (String(profile_photo).trim() || null) : current.profile_photo;
    const usernameChanged = nextUsername !== current.username;
    const passwordChanged = Boolean(new_password);
    if (nextUsername.length < 3 || nextFullName.length < 2) {
      return res.status(400).json({ success: false, message: 'Full name must be at least 2 characters and username at least 3 characters.' });
    }
    if ((usernameChanged || passwordChanged) && !current_password) {
      return res.status(400).json({ success: false, message: 'Current password is required for account security changes.' });
    }
    if ((usernameChanged || passwordChanged) && !(await bcrypt.compare(String(current_password), current.password))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }
    if (passwordChanged) {
      const passwordCheck = validatePassword(new_password);
      if (!passwordCheck.valid) {
        return res.status(400).json({ success: false, message: passwordCheck.message, requirements: passwordCheck.requirements });
      }
    }
    if (nextPhoto && !(await isStoredProfilePhoto(nextPhoto))) {
      return res.status(400).json({ success: false, message: 'Profile photo path is invalid or the image file is missing' });
    }

    const [duplicate] = await pool.query(
      'SELECT user_id FROM users WHERE username = ? AND user_id <> ? LIMIT 1',
      [nextUsername, current.user_id]
    );
    if (duplicate.length) {
      return res.status(409).json({ success: false, message: 'Username already exists' });
    }

    const nextPassword = new_password
      ? await bcrypt.hash(String(new_password), 10)
      : current.password;
    await pool.query(
      `UPDATE users SET full_name = ?, username = ?, password = ?, profile_photo = ?${passwordChanged ? ', token_version = token_version + 1, must_change_password = 0, password_changed_at = UTC_TIMESTAMP(), temp_password_expires_at = NULL' : ''} WHERE user_id = ?`,
      [nextFullName, nextUsername, nextPassword, nextPhoto, current.user_id]
    );
    if (passwordChanged) {
      await pool.query(
        "UPDATE user_login_history SET status = 'REVOKED', ended_at = NOW() WHERE user_id = ? AND status = 'ACTIVE'",
        [current.user_id]
      );
    }

    await writeAudit({
      user_id: current.user_id,
      action: 'ACCOUNT_SETTINGS_UPDATED',
      module: 'account-settings',
      table_name: 'users',
      record_id: current.user_id,
      old_data: { full_name: current.full_name, username: current.username, profile_photo: current.profile_photo },
      new_data: { full_name: nextFullName, username: nextUsername, profile_photo: nextPhoto, password_changed: Boolean(new_password) },
      status: 'SUCCESS'
    });

    return res.json({
      success: true,
      message: 'Account settings updated successfully',
      data: { user_id: current.user_id, full_name: nextFullName, username: nextUsername, role: current.role, profile_photo: nextPhoto }
    });
  } catch (error) {
    logger.error('updateAdminSettings error', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Username already exists.' });
    }
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getAccountSettings = async (req, res) => {
  try {
    await ensureAccountSecuritySchema();
    const preferences = await readPreferences(req.user.user_id);
    const [history] = await pool.query(
      "SELECT id, session_id, ip_address, user_agent, CASE WHEN status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at < UTC_TIMESTAMP() THEN 'EXPIRED' ELSE status END AS status, occurred_at, ended_at FROM user_login_history WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 20",
      [req.user.user_id]
    );
    return res.json({
      success: true,
      data: {
        preferences,
        loginHistory: history.map((entry) => ({ ...entry, current: entry.session_id === req.user.jti })),
      },
    });
  } catch (error) {
    logger.error('getAccountSettings error', error);
    return res.status(500).json({ success: false, message: 'Unable to load account settings.' });
  }
};

const saveAccountPreferences = async (req, res) => {
  try {
    await ensureAccountSecuritySchema();
    const supplied = req.body?.preferences;
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
      return res.status(400).json({ success: false, message: 'Valid preferences are required.' });
    }

    const themeValues = ['light', 'dark', 'system'];
    const textSizes = ['small', 'default', 'large', 'extra-large'];
    const notifications = supplied.notifications || {};
    if (!themeValues.includes(supplied.theme) || !textSizes.includes(supplied.textSize)
      || ['nutritionAlerts', 'seniorFollowUpAlerts', 'offlineSyncAlerts', 'newResidentAlerts'].some((key) => typeof notifications[key] !== 'boolean')) {
      return res.status(400).json({ success: false, message: 'One or more account preferences are invalid.' });
    }

    const preferences = {
      ...defaultPreferences,
      theme: supplied.theme,
      textSize: supplied.textSize,
      notifications: {
        nutritionAlerts: notifications.nutritionAlerts,
        seniorFollowUpAlerts: notifications.seniorFollowUpAlerts,
        offlineSyncAlerts: notifications.offlineSyncAlerts,
        newResidentAlerts: notifications.newResidentAlerts,
      },
    };
    await pool.query(
      'INSERT INTO user_preferences (user_id, preferences) VALUES (?, ?) ON DUPLICATE KEY UPDATE preferences = VALUES(preferences)',
      [req.user.user_id, JSON.stringify(preferences)]
    );
    return res.json({ success: true, data: preferences, message: 'Settings saved.' });
  } catch (error) {
    logger.error('saveAccountPreferences error', error);
    return res.status(500).json({ success: false, message: 'Unable to save account preferences.' });
  }
};

const changeAccountPassword = async (req, res) => {
  try {
    await ensureAccountSecuritySchema();
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, message: 'Current and new passwords are required.' });
    }

    const [rows] = await pool.query('SELECT password FROM users WHERE user_id = ? LIMIT 1', [req.user.user_id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Account not found.' });
    if (!(await bcrypt.compare(String(current_password), rows[0].password))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    const passwordCheck = validatePassword(new_password);
    if (!passwordCheck.valid) {
      return res.status(400).json({ success: false, message: passwordCheck.message, requirements: passwordCheck.requirements });
    }
    if (await bcrypt.compare(String(new_password), rows[0].password)) {
      return res.status(400).json({ success: false, message: 'Choose a password different from your current password.' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(
        'UPDATE users SET password = ?, token_version = token_version + 1, must_change_password = 0, password_changed_at = UTC_TIMESTAMP(), temp_password_expires_at = NULL WHERE user_id = ?',
        [await bcrypt.hash(String(new_password), 10), req.user.user_id]
      );
      if (!result.affectedRows) throw new Error('Account password could not be updated.');
      await connection.query(
        "UPDATE user_login_history SET status = 'REVOKED', ended_at = NOW() WHERE user_id = ? AND status = 'ACTIVE'",
        [req.user.user_id]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await writeAudit({
      user_id: req.user.user_id,
      action: 'ACCOUNT_PASSWORD_UPDATED',
      module: 'account-settings',
      table_name: 'users',
      record_id: req.user.user_id,
      new_data: { password_changed: true, sessions_revoked: true },
      status: 'SUCCESS',
    });
    return res.json({ success: true, message: 'Password updated. Please sign in again.' });
  } catch (error) {
    logger.error('changeAccountPassword error', error);
    return res.status(500).json({ success: false, message: 'Unable to update password.' });
  }
};

const revokeAllSessions = async (req, res) => {
  try {
    await ensureAccountSecuritySchema();
    const currentPassword = String(req.body?.current_password || '');
    if (!currentPassword) return res.status(400).json({ success: false, message: 'Current password is required.' });
    const [rows] = await pool.query('SELECT password FROM users WHERE user_id = ? LIMIT 1', [req.user.user_id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Account not found.' });
    if (!(await bcrypt.compare(currentPassword, rows[0].password))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        "UPDATE user_login_history SET status = 'REVOKED', ended_at = NOW() WHERE user_id = ? AND status = 'ACTIVE'",
        [req.user.user_id]
      );
      await connection.query('UPDATE users SET token_version = token_version + 1 WHERE user_id = ?', [req.user.user_id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await writeAudit({
      user_id: req.user.user_id,
      action: 'ACCOUNT_SESSIONS_REVOKED',
      module: 'account-settings',
      table_name: 'users',
      record_id: req.user.user_id,
      new_data: { sessions_revoked: true },
      status: 'SUCCESS',
    });
    return res.json({ success: true, message: 'All sessions have been signed out.' });
  } catch (error) {
    logger.error('revokeAllSessions error', error);
    return res.status(500).json({ success: false, message: 'Unable to sign out all devices.' });
  }
};

const exportLoginHistory = async (req, res) => {
  try {
    await ensureAccountSecuritySchema();
    const [rows] = await pool.query(
      'SELECT status, ip_address, user_agent, occurred_at, ended_at FROM user_login_history WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 5000',
      [req.user.user_id]
    );
    const csvValue = (value) => {
      const text = String(value ?? '');
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = [
      ['Status', 'IP address', 'Device / browser', 'Signed in at', 'Ended at'].map(csvValue).join(','),
      ...rows.map((entry) => [entry.status, entry.ip_address, entry.user_agent, entry.occurred_at, entry.ended_at].map(csvValue).join(',')),
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="healthsync-account-activity.csv"');
    return res.send(`\uFEFF${csv}`);
  } catch (error) {
    logger.error('exportLoginHistory error', error);
    return res.status(500).json({ success: false, message: 'Unable to export account activity.' });
  }
};

module.exports = {
  updateAdminSettings,
  ensureUserPhotoColumn,
  getAccountSettings,
  saveAccountPreferences,
  changeAccountPassword,
  revokeAllSessions,
  exportLoginHistory,
};
