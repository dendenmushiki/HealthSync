const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../config/database');
const logger = require('../services/logger');
const { writeAudit } = require('../services/auditService');
const { validatePassword } = require('../services/passwordPolicy');
const { ensureUserManagementSchema } = require('../services/userManagementService');
const { validateUserContactInfo } = require('../services/userProfileValidation');
const configuredExpiryHours = Number.parseInt(process.env.TEMP_PASSWORD_EXPIRY_HOURS, 10);
const TEMP_PASSWORD_EXPIRY_HOURS = Number.isInteger(configuredExpiryHours) && configuredExpiryHours > 0
  ? Math.min(configuredExpiryHours, 720) : 72;

const normalizeUserRole = (role) => {
  if (role === undefined || role === null || role === '') return null;
  const normalized = String(role).trim().toLowerCase().replace(/[-_\s]+/g, '_');
  const canonicalByAlias = {
    admin: 'admin',
    bhw: 'bhw',
    official: 'barangay_official',
    barangay_official: 'barangay_official',
    barangayofficial: 'barangay_official',
  };
  return canonicalByAlias[normalized] || null;
};

const normalizeRoleLabel = (role) => {
  const normalized = String(role || '').trim().toLowerCase();
  return normalized === 'barangay_official' ? 'official' : normalized;
};

const isProtectedSystemUser = (user) => {
  const username = user && (user.username || user.full_name);
  return Boolean(username && String(username).trim().toLowerCase() === 'hsync_admin');
};

const normalizeUserStatus = (value, fallback = true) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['0', 'false', 'inactive', 'disabled', 'deactivated', 'off'].includes(text)) return false;
  if (['1', 'true', 'active', 'enabled', 'activated', 'on'].includes(text)) return true;
  return Boolean(value);
};

const isActive = (user) => user.is_active !== false && Number(user.is_active) !== 0;
const isLocked = (user) => Boolean(user.locked_until && new Date(user.locked_until).getTime() > Date.now());
const validId = (id) => /^\d+$/.test(String(id || '')) && Number(id) > 0;

const sendError = (res, status, message, errorCode, fieldErrors) => res.status(status).json({
  success: false,
  message,
  ...(errorCode ? { errorCode } : {}),
  ...(fieldErrors ? { fieldErrors } : {}),
});

const writeUserAudit = (req, { action, targetId, description, old_data = null, new_data = null }) => writeAudit({
  user_id: req.user?.user_id || null,
  action,
  module: 'users',
  description,
  table_name: 'users',
  record_id: targetId,
  old_data,
  new_data,
  ip_address: req.ip || null,
  user_agent: String(req.get('user-agent') || '').slice(0, 512) || null,
  status: 'SUCCESS',
});

const generateTemporaryPassword = () => {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%&*?',
  ];
  const alphabet = groups.join('');
  const chars = groups.map((group) => group[crypto.randomInt(group.length)]);
  while (chars.length < 20) chars.push(alphabet[crypto.randomInt(alphabet.length)]);
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }
  return chars.join('');
};

const getTemporaryPassword = (mode, suppliedPassword) => {
  if (mode === 'manual' || suppliedPassword) {
    const password = typeof suppliedPassword === 'string' ? suppliedPassword : '';
    const check = validatePassword(password);
    return check.valid ? { password } : { error: check.message };
  }
  return { password: generateTemporaryPassword() };
};

const validateIdentity = ({ full_name, username, role }) => {
  const name = typeof full_name === 'string' ? full_name.trim() : '';
  const cleanUsername = typeof username === 'string' ? username.trim() : '';
  const normalizedRole = normalizeUserRole(role);
  const fieldErrors = {};
  if (name.length < 2 || name.length > 120) fieldErrors.full_name = 'Enter a name between 2 and 120 characters.';
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(cleanUsername)) {
    fieldErrors.username = 'Use 3-32 letters, numbers, dots, underscores, or hyphens.';
  }
  if (!normalizedRole) fieldErrors.role = 'Choose a valid role.';
  return { name, username: cleanUsername, role: normalizedRole, fieldErrors };
};

const listUsers = async (req, res) => {
  try {
    await ensureUserManagementSchema();
    const rawSearch = req.query.search;
    if (rawSearch !== undefined && typeof rawSearch !== 'string') return sendError(res, 400, 'Search must be text.');
    if (typeof rawSearch === 'string' && rawSearch.length > 120) return sendError(res, 400, 'Search must be 120 characters or fewer.');
    const search = String(req.query.search || '').trim().slice(0, 120);
    const role = req.query.role ? normalizeUserRole(req.query.role) : null;
    if (req.query.role && !role) return sendError(res, 400, 'Choose a valid user role.');
    if (req.query.status && !['active', 'inactive', 'locked'].includes(req.query.status)) return sendError(res, 400, 'Choose a valid user status.');
    if (req.query.passwordStatus && !['temporary', 'normal'].includes(req.query.passwordStatus)) return sendError(res, 400, 'Choose a valid password status.');
    if (req.query.sort && !['name', 'newest', 'last_login', 'role'].includes(req.query.sort)) return sendError(res, 400, 'Choose a valid sort order.');
    if (req.query.page !== undefined && !/^\d+$/.test(String(req.query.page))) return sendError(res, 400, 'Page must be a positive number.');
    if (req.query.pageSize !== undefined && !/^(10|25|50)$/.test(String(req.query.pageSize))) return sendError(res, 400, 'Page size must be 10, 25, or 50.');
    const status = req.query.status || '';
    const passwordStatus = req.query.passwordStatus || '';
    const sort = req.query.sort || 'name';
    const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
    const pageSize = Number(req.query.pageSize) || 10;
    const clauses = ['1 = 1'];
    const params = [];

    if (search) {
      clauses.push('(u.full_name LIKE ? OR u.username LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (role) {
      clauses.push('u.role = ?');
      params.push(role);
    }
    if (status === 'inactive') clauses.push('u.is_active = 0');
    if (status === 'locked') clauses.push('u.is_active = 1 AND u.locked_until > UTC_TIMESTAMP()');
    if (status === 'active') clauses.push('u.is_active = 1 AND (u.locked_until IS NULL OR u.locked_until <= UTC_TIMESTAMP())');
    if (passwordStatus === 'temporary') clauses.push('u.must_change_password = 1');
    if (passwordStatus === 'normal') clauses.push('u.must_change_password = 0');

    const orderBy = {
      name: 'u.full_name ASC, u.user_id ASC',
      newest: 'u.created_at DESC, u.user_id DESC',
      last_login: 'u.last_login_at DESC, u.full_name ASC',
      role: "FIELD(u.role, 'admin', 'barangay_official', 'bhw'), u.full_name ASC",
    }[sort];
    const where = clauses.join(' AND ');
    const [[countRows], [rows], [summaryRows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM users u WHERE ${where}`, params),
      pool.query(
        `SELECT u.user_id, u.full_name, u.username, u.contact_number, u.email, u.role, u.profile_photo, u.is_active, u.must_change_password,
          u.temp_password_expires_at, u.last_login_at, u.created_at, u.locked_until,
          CASE WHEN u.is_active = 1 AND u.locked_until > UTC_TIMESTAMP() THEN 1 ELSE 0 END AS is_locked,
          CASE WHEN u.must_change_password = 1 AND u.temp_password_expires_at IS NOT NULL
            AND u.temp_password_expires_at <= UTC_TIMESTAMP() THEN 1 ELSE 0 END AS temp_password_expired
         FROM users u WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      ),
      pool.query(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN is_active = 1 AND (locked_until IS NULL OR locked_until <= UTC_TIMESTAMP()) THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive,
        SUM(CASE WHEN is_active = 1 AND locked_until > UTC_TIMESTAMP() THEN 1 ELSE 0 END) AS locked,
        SUM(CASE WHEN must_change_password = 1 THEN 1 ELSE 0 END) AS temporary,
        SUM(CASE WHEN role = 'admin' AND is_active = 1 THEN 1 ELSE 0 END) AS active_admins
        FROM users`)
    ]);

    return res.json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        role: normalizeRoleLabel(row.role),
        is_active: isActive(row),
        is_locked: Boolean(row.is_locked),
        must_change_password: Boolean(row.must_change_password),
        temp_password_expired: Boolean(row.temp_password_expired),
        protected: isProtectedSystemUser(row),
      })),
      total: Number(countRows[0].total || 0),
      page,
      pageSize,
      counts: Object.fromEntries(Object.entries(summaryRows[0] || {}).map(([key, value]) => [key, Number(value || 0)])),
    });
  } catch (error) {
    logger.error('listUsers error', error);
    return sendError(res, 500, 'Unable to load users.');
  }
};

const checkUsername = async (req, res) => {
  try {
    const username = String(req.query.username || '').trim();
    if (req.query.exclude !== undefined && !validId(req.query.exclude)) return sendError(res, 400, 'Invalid user ID.');
    const excludeId = validId(req.query.exclude) ? Number(req.query.exclude) : 0;
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      return res.json({ success: true, available: false, message: 'Use 3-32 letters, numbers, dots, underscores, or hyphens.' });
    }
    const [rows] = await pool.query(
      'SELECT user_id FROM users WHERE username = ? AND user_id <> ? LIMIT 1',
      [username, excludeId]
    );
    return res.json({ success: true, available: rows.length === 0 });
  } catch (error) {
    logger.error('checkUsername error', error);
    return sendError(res, 500, 'Unable to check username availability.');
  }
};

const getUser = async (req, res) => {
  try {
    await ensureUserManagementSchema();
    const { id } = req.params;
    if (!validId(id)) return sendError(res, 400, 'Invalid user ID.');
    const [rows] = await pool.query(
      `SELECT u.user_id, u.full_name, u.username, u.contact_number, u.email, u.role, u.profile_photo, u.is_active, u.created_at, u.updated_at,
        u.created_by, creator.full_name AS created_by_name, u.last_login_at, u.password_changed_at,
        u.must_change_password, u.offline_pin_setup_required, (u.offline_pin_hash IS NOT NULL) AS offline_pin_enrolled,
        u.temp_password_expires_at, u.failed_login_attempts, u.locked_until,
        (u.must_change_password = 1 AND u.temp_password_expires_at IS NOT NULL
          AND u.temp_password_expires_at <= UTC_TIMESTAMP()) AS temp_password_expired,
        (SELECT COUNT(*) FROM user_login_history h WHERE h.user_id = u.user_id AND h.status = 'ACTIVE'
          AND (h.expires_at IS NULL OR h.expires_at > UTC_TIMESTAMP())) AS active_sessions
       FROM users u LEFT JOIN users creator ON creator.user_id = u.created_by WHERE u.user_id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) return sendError(res, 404, 'User not found.');
    const [activity] = await pool.query(
      `SELECT al.audit_id, al.user_id, al.action, al.description, al.status, al.created_at,
        actor.full_name AS actor_name
       FROM audit_logs al LEFT JOIN users actor ON actor.user_id = al.user_id
       WHERE (al.module = 'users' AND al.record_id = ?) OR al.user_id = ?
       ORDER BY al.created_at DESC, al.audit_id DESC LIMIT 10`,
      [id, id]
    );
    const row = rows[0];
    return res.json({
      success: true,
      data: {
        ...row,
        role: normalizeRoleLabel(row.role),
        is_active: isActive(row),
        is_locked: isLocked(row),
        must_change_password: Boolean(row.must_change_password),
        offline_pin_setup_required: Boolean(row.offline_pin_setup_required),
        offline_pin_enrolled: Boolean(row.offline_pin_enrolled),
        temp_password_expired: Boolean(row.temp_password_expired),
        protected: isProtectedSystemUser(row),
        active_sessions: Number(row.active_sessions || 0),
        activity,
      },
    });
  } catch (error) {
    logger.error('getUser error', error);
    return sendError(res, 500, 'Unable to load user details.');
  }
};

const createUser = async (req, res) => {
  try {
    await ensureUserManagementSchema();
    const identity = validateIdentity(req.body || {});
    const contactInfo = validateUserContactInfo(req.body || {}, { required: true });
    const fieldErrors = { ...identity.fieldErrors, ...contactInfo.fieldErrors };
    if (Object.keys(fieldErrors).length) {
      return sendError(res, 400, 'Check the highlighted fields.', 'VALIDATION_ERROR', fieldErrors);
    }
    const passwordResult = getTemporaryPassword(req.body?.password_mode, req.body?.password);
    if (passwordResult.error) {
      return sendError(res, 400, passwordResult.error, 'VALIDATION_ERROR', { password: passwordResult.error });
    }

    const passwordHash = await bcrypt.hash(passwordResult.password, 10);
    const [result] = await pool.query(
      `INSERT INTO users (full_name, username, contact_number, email, password, role, is_active, must_change_password,
        offline_pin_setup_required, temp_password_expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${TEMP_PASSWORD_EXPIRY_HOURS} HOUR), ?)`,
      [identity.name, identity.username, contactInfo.contact_number, contactInfo.email, passwordHash, identity.role, req.user.user_id]
    );
    const [rows] = await pool.query(
      `SELECT user_id, full_name, username, contact_number, email, role, is_active, must_change_password, temp_password_expires_at, created_at
       FROM users WHERE user_id = ?`,
      [result.insertId]
    );
    const user = {
      ...rows[0],
      role: normalizeRoleLabel(rows[0].role),
      is_active: true,
      must_change_password: true,
      temp_password_expires_in_hours: TEMP_PASSWORD_EXPIRY_HOURS,
    };
    await writeUserAudit(req, {
      action: 'user_created',
      targetId: result.insertId,
      description: `Created user ${identity.username}`,
      new_data: { full_name: identity.name, username: identity.username, contact_number: contactInfo.contact_number, email: contactInfo.email, role: identity.role, is_active: true },
    });
    return res.status(201).json({
      success: true,
      data: { user, temporary_password: passwordResult.password },
      message: 'User created. Copy the temporary password now; it will not be shown again.',
    });
  } catch (error) {
    logger.error('createUser error', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(res, 409, 'That username is already in use.', 'USERNAME_TAKEN', { username: 'That username is already in use.' });
    }
    return sendError(res, 500, 'Unable to create the user.');
  }
};

const lockActiveAdmins = async (connection) => {
  const [admins] = await connection.query(
    "SELECT user_id FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY user_id FOR UPDATE"
  );
  return admins;
};

const updateUser = async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return sendError(res, 400, 'Invalid user ID.');
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'password')) {
    return sendError(res, 400, 'Passwords can only be changed through password reset or Settings.');
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'full_name') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'username')) {
    return sendError(res, 403, 'Users can change their own name and username in Settings.', 'PROFILE_OWNER_ONLY');
  }
  const role = normalizeUserRole(req.body?.role);
  if (!role) return sendError(res, 400, 'Choose a valid role.', 'VALIDATION_ERROR', { role: 'Choose a valid role.' });

  const connection = await pool.getConnection();
  try {
    await ensureUserManagementSchema();
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM users WHERE user_id = ? FOR UPDATE', [id]);
    if (!rows.length) {
      await connection.rollback();
      return sendError(res, 404, 'User not found.');
    }
    const current = rows[0];
    if (isProtectedSystemUser(current)) {
      await connection.rollback();
      return sendError(res, 403, 'The primary admin account can only be changed from its own Settings page.', 'PROTECTED_USER');
    }
    if (Number(id) === Number(req.user.user_id) && role !== normalizeUserRole(current.role)) {
      await connection.rollback();
      return sendError(res, 403, 'You cannot change your own role.', 'SELF_ROLE_CHANGE');
    }

    const roleChanged = role !== normalizeUserRole(current.role);
    if (roleChanged && normalizeUserRole(current.role) === 'admin' && role !== 'admin' && isActive(current)) {
      const admins = await lockActiveAdmins(connection);
      if (admins.length <= 1) {
        await connection.rollback();
        return sendError(res, 409, 'The last active admin cannot be demoted.', 'LAST_ACTIVE_ADMIN');
      }
    }

    await connection.query(
      `UPDATE users SET role = ?, token_version = token_version + ?, updated_at = UTC_TIMESTAMP() WHERE user_id = ?`,
      [role, roleChanged ? 1 : 0, id]
    );
    if (roleChanged) {
      await connection.query(
        "UPDATE user_login_history SET status = 'REVOKED', ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'ACTIVE'",
        [id]
      );
    }
    await connection.commit();
    if (roleChanged) {
      await writeUserAudit(req, {
        action: 'role_changed',
        targetId: id,
        description: `Changed ${current.username}'s role`,
        old_data: { role: normalizeRoleLabel(current.role) },
        new_data: { role: normalizeRoleLabel(role) },
      });
    }
    return res.json({ success: true, message: 'User updated successfully.' });
  } catch (error) {
    await connection.rollback();
    logger.error('updateUser error', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(res, 409, 'That username is already in use.', 'USERNAME_TAKEN', { username: 'That username is already in use.' });
    }
    return sendError(res, 500, 'Unable to update the user.');
  } finally {
    connection.release();
  }
};

const setUserActive = async (req, res, active) => {
  const { id } = req.params;
  if (!validId(id)) return sendError(res, 400, 'Invalid user ID.');
  if (!active && Number(id) === Number(req.user.user_id)) {
    return sendError(res, 403, 'You cannot deactivate your own account.', 'SELF_DEACTIVATION');
  }
  const connection = await pool.getConnection();
  try {
    await ensureUserManagementSchema();
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM users WHERE user_id = ? FOR UPDATE', [id]);
    if (!rows.length) {
      await connection.rollback();
      return sendError(res, 404, 'User not found.');
    }
    const current = rows[0];
    if (!active && isProtectedSystemUser(current)) {
      await connection.rollback();
      return sendError(res, 403, 'The primary admin account cannot be deactivated.', 'PROTECTED_USER');
    }
    if (!active && normalizeUserRole(current.role) === 'admin' && isActive(current)) {
      const admins = await lockActiveAdmins(connection);
      if (admins.length <= 1) {
        await connection.rollback();
        return sendError(res, 409, 'The last active admin cannot be deactivated.', 'LAST_ACTIVE_ADMIN');
      }
    }
    await connection.query(
      'UPDATE users SET is_active = ?, token_version = token_version + ?, updated_at = UTC_TIMESTAMP() WHERE user_id = ?',
      [active ? 1 : 0, active ? 0 : 1, id]
    );
    if (!active) {
      await connection.query(
        "UPDATE user_login_history SET status = 'REVOKED', ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'ACTIVE'",
        [id]
      );
    }
    await connection.commit();
    await writeUserAudit(req, {
      action: active ? 'user_reactivated' : 'user_deactivated',
      targetId: id,
      description: `${active ? 'Reactivated' : 'Deactivated'} user ${current.username}`,
      old_data: { is_active: isActive(current) },
      new_data: { is_active: active },
    });
    return res.json({ success: true, message: active ? 'User reactivated.' : 'User deactivated and signed out.' });
  } catch (error) {
    await connection.rollback();
    logger.error('setUserActive error', error);
    return sendError(res, 500, 'Unable to update user status.');
  } finally {
    connection.release();
  }
};

const updateUserStatus = async (req, res) => {
  const active = normalizeUserStatus(req.body?.is_active, true);
  return setUserActive(req, res, active);
};

const deactivateUser = (req, res) => setUserActive(req, res, false);
const reactivateUser = (req, res) => setUserActive(req, res, true);

const resetUserPassword = async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return sendError(res, 400, 'Invalid user ID.');
  if (Number(id) === Number(req.user.user_id)) {
    return sendError(res, 403, 'Use Settings to change your own password.', 'SELF_PASSWORD_RESET');
  }
  const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
  if (!currentPassword) return sendError(res, 400, 'Enter your current password to confirm this reset.', 'CURRENT_PASSWORD_REQUIRED');

  try {
    await ensureUserManagementSchema();
    const [[actorRows], [targetRows]] = await Promise.all([
      pool.query('SELECT password FROM users WHERE user_id = ? LIMIT 1', [req.user.user_id]),
      pool.query('SELECT user_id, username, role FROM users WHERE user_id = ? LIMIT 1', [id]),
    ]);
    if (!targetRows.length) return sendError(res, 404, 'User not found.');
    if (!(await bcrypt.compare(currentPassword, actorRows[0]?.password || ''))) {
      return sendError(res, 401, 'Your current password is incorrect.', 'CURRENT_PASSWORD_INVALID');
    }
    const target = targetRows[0];
    if (isProtectedSystemUser(target)) {
      return sendError(res, 403, 'The primary admin account cannot be reset here.', 'PROTECTED_USER');
    }
    const passwordResult = getTemporaryPassword(req.body?.password_mode, req.body?.password);
    if (passwordResult.error) {
      return sendError(res, 400, passwordResult.error, 'VALIDATION_ERROR', { password: passwordResult.error });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `UPDATE users SET password = ?, must_change_password = 1,
          temp_password_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${TEMP_PASSWORD_EXPIRY_HOURS} HOUR),
          failed_login_attempts = 0, locked_until = NULL, token_version = token_version + 1,
          updated_at = UTC_TIMESTAMP() WHERE user_id = ?`,
        [await bcrypt.hash(passwordResult.password, 10), id]
      );
      await connection.query(
        "UPDATE user_login_history SET status = 'REVOKED', ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'ACTIVE'",
        [id]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    await writeUserAudit(req, {
      action: 'password_reset',
      targetId: id,
      description: `Reset password for ${target.username}`,
      new_data: { must_change_password: true, sessions_revoked: true },
    });
    return res.json({
      success: true,
      data: {
        temporary_password: passwordResult.password,
        expires_at: new Date(Date.now() + TEMP_PASSWORD_EXPIRY_HOURS * 60 * 60 * 1000).toISOString(),
        expires_in_hours: TEMP_PASSWORD_EXPIRY_HOURS,
      },
      message: 'Password reset. Copy the temporary password now; it will not be shown again.',
    });
  } catch (error) {
    logger.error('resetUserPassword error', error);
    return sendError(res, 500, 'Unable to reset the user password.');
  }
};

const unlockUser = async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return sendError(res, 400, 'Invalid user ID.');
  try {
    const [users] = await pool.query('SELECT user_id FROM users WHERE user_id = ? LIMIT 1', [id]);
    if (!users.length) return sendError(res, 404, 'User not found.');
    await pool.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = UTC_TIMESTAMP() WHERE user_id = ?',
      [id]
    );
    await writeUserAudit(req, {
      action: 'user_unlocked',
      targetId: id,
      description: `Unlocked user account ${id}`,
      new_data: { failed_login_attempts: 0, locked_until: null },
    });
    return res.json({ success: true, message: 'User unlocked.' });
  } catch (error) {
    logger.error('unlockUser error', error);
    return sendError(res, 500, 'Unable to unlock the user.');
  }
};

const logoutAllUserSessions = async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return sendError(res, 400, 'Invalid user ID.');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.query('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [id]);
    if (!users.length) {
      await connection.rollback();
      return sendError(res, 404, 'User not found.');
    }
    await connection.query(
      "UPDATE user_login_history SET status = 'REVOKED', ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'ACTIVE'",
      [id]
    );
    await connection.query('UPDATE users SET token_version = token_version + 1 WHERE user_id = ?', [id]);
    await connection.commit();
    await writeUserAudit(req, {
      action: 'sessions_revoked',
      targetId: id,
      description: `Signed out all sessions for user ${id}`,
      new_data: { sessions_revoked: true },
    });
    return res.json({ success: true, message: 'All sessions have been signed out.' });
  } catch (error) {
    await connection.rollback();
    logger.error('logoutAllUserSessions error', error);
    return sendError(res, 500, 'Unable to sign out the user on all devices.');
  } finally {
    connection.release();
  }
};

module.exports = {
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
  normalizeUserRole,
  normalizeUserStatus,
  normalizeRoleLabel,
  isProtectedSystemUser,
  generateTemporaryPassword,
  ensureUserStatusColumn: ensureUserManagementSchema,
};
