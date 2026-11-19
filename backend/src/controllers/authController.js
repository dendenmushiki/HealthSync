const pool = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

const { logAudit } = require('../services/auditService');
const { ensureUserStatusColumn, normalizeRoleLabel } = require('./userController');
const { ensureUserPhotoColumn } = require('./adminSettingsController');
const { ensureAccountSecuritySchema, readPreferences } = require('../services/accountSecurityService');
const { ensureUserManagementSchema } = require('../services/userManagementService');
const {
    ensureOfflineSecuritySchema,
    isDevicePinEnrolled,
    registerOrCheckDevice,
} = require('../services/offlineSecurityService');
const { validatePassword } = require('../services/passwordPolicy');

const recordLoginHistory = async ({ userId, sessionId = null, status, req, expiresAt = null }) => {
    await pool.query(
        'INSERT INTO user_login_history (user_id, session_id, ip_address, user_agent, status, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        [userId || null, sessionId, req.ip || null, String(req.get('user-agent') || '').slice(0, 512) || null, status, expiresAt]
    );
};

const login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            message: 'Username and password required'
        });
    }

    try {
        await ensureUserStatusColumn();
        await ensureUserPhotoColumn();
        await ensureAccountSecuritySchema();
        await ensureUserManagementSchema();
        await ensureOfflineSecuritySchema();

        const [rows] = await pool.query(
            `SELECT user_id, full_name, username, password, role, is_active, profile_photo, token_version,
                must_change_password, offline_pin_setup_required, offline_pin_hash, offline_pin_version,
                temp_password_expires_at, failed_login_attempts, locked_until,
                (locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP()) AS is_locked,
                (temp_password_expires_at IS NOT NULL AND temp_password_expires_at <= UTC_TIMESTAMP()) AS temp_password_expired
             FROM users WHERE username = ?`,
            [username]
        );

        if (!rows || rows.length === 0) {
            await logAudit({
                actorId: null,
                action: 'LOGIN_FAILED',
                module: 'auth',
                description: 'Failed sign-in for an unknown account.',
                targetType: 'username',
                targetId: String(username).slice(0, 64),
                targetLabel: `@${String(username).slice(0, 120)}`,
                status: 'FAILED',
                severity: 'warning',
                req,
            });
            await recordLoginHistory({ status: 'FAILED', req });

            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const user = rows[0];

        if (user.is_active === false || user.is_active === 0) {
            await logAudit({
                actorId: null,
                user_id: user.user_id,
                action: 'LOGIN_FAILED',
                module: 'auth',
                description: 'Sign-in blocked because the account is deactivated.',
                targetType: 'user',
                targetId: user.user_id,
                targetLabel: `@${user.username}`,
                status: 'FAILED',
                severity: 'warning',
                req,
            });
            await recordLoginHistory({ userId: user.user_id, status: 'FAILED', req });

            return res.status(403).json({
                success: false,
                message: 'Account is deactivated'
            });
        }

        if (Boolean(user.is_locked)) {
            return res.status(423).json({
                success: false,
                message: 'This account is temporarily locked. Contact an administrator or try again later.',
                errorCode: 'ACCOUNT_LOCKED',
            });
        }

        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            await pool.query(
                `UPDATE users SET failed_login_attempts = failed_login_attempts + 1,
                  locked_until = CASE WHEN failed_login_attempts >= 4
                    THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE) ELSE locked_until END
                 WHERE user_id = ?`,
                [user.user_id]
            );
            const [attemptRows] = await pool.query(
                'SELECT failed_login_attempts, (locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP()) AS is_locked FROM users WHERE user_id = ? LIMIT 1',
                [user.user_id]
            );
            await logAudit({
                actorId: null,
                user_id: user.user_id,
                action: 'LOGIN_FAILED',
                module: 'auth',
                description: 'Invalid password for account',
                targetType: 'user',
                targetId: user.user_id,
                targetLabel: `@${user.username}`,
                status: 'FAILED',
                severity: 'warning',
                req,
            });
            await recordLoginHistory({ userId: user.user_id, status: 'FAILED', req });

            if (Boolean(attemptRows[0]?.is_locked)) {
                await logAudit({
                    actorId: null,
                    user_id: user.user_id,
                    action: 'ACCOUNT_LOCKED',
                    module: 'auth',
                    description: 'Account locked after repeated failed sign-ins.',
                    targetType: 'user',
                    targetId: user.user_id,
                    targetLabel: `@${user.username}`,
                    result: 'failure',
                    severity: 'critical',
                    req,
                });
                return res.status(423).json({
                    success: false,
                    message: 'Too many failed attempts. This account is locked for 15 minutes.',
                    errorCode: 'ACCOUNT_LOCKED',
                });
            }
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        if (user.must_change_password && Boolean(user.temp_password_expired)) {
            return res.status(403).json({
                success: false,
                message: 'The temporary password has expired. Contact your administrator for a new one.',
                errorCode: 'TEMP_PASSWORD_EXPIRED',
            });
        }

        const device = await registerOrCheckDevice({
            userId: user.user_id,
            deviceId: req.body.device_id,
            publicKey: req.body.device_public_key,
            challenge: req.body.device_challenge,
            signature: req.body.device_proof,
        });
        if (!device.ok) {
            const messages = {
                DEVICE_REVOKED: 'This device has been revoked. Contact an administrator to authorize a new device.',
                DEVICE_ENROLLMENT_REQUIRED: 'This device requires approval by an administrator before sign-in.',
                DEVICE_MISMATCH: 'This device identity does not match its registration.',
                INVALID_DEVICE: 'Secure device registration could not be verified.',
            };
            await recordLoginHistory({ userId: user.user_id, status: 'FAILED', req });
            return res.status(403).json({
                success: false,
                message: messages[device.code] || 'This device is not authorized.',
                errorCode: device.code,
            });
        }

        await pool.query(
            'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = UTC_TIMESTAMP() WHERE user_id = ?',
            [user.user_id]
        );

        const sessionId = crypto.randomBytes(24).toString('hex');

        const payload = {
            user_id: user.user_id,
            username: user.username,
            role: normalizeRoleLabel(user.role),
            token_version: Number(user.token_version || 0),
            device_id: device.deviceId,
            jti: sessionId
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET,
            {
                expiresIn: process.env.JWT_EXPIRES_IN || '8h'
            }
        );

        const tokenExpiration = jwt.decode(token)?.exp;
        await recordLoginHistory({
            userId: user.user_id,
            sessionId,
            status: 'ACTIVE',
            req,
            expiresAt: tokenExpiration ? new Date(tokenExpiration * 1000) : null,
        });
        await logAudit({
            actorId: user.user_id,
            user_id: user.user_id,
            action: 'LOGIN',
            module: 'auth',
            description: 'User signed in.',
            targetType: 'user',
            targetId: user.user_id,
            targetLabel: `@${user.username}`,
            result: 'success',
            req,
        });
        const preferences = await readPreferences(user.user_id);

        return res.json({
            success: true,
            message: 'Authenticated',
            data: {
                token,
                user: {
                    user_id: user.user_id,
                    full_name: user.full_name,
                    username: user.username,
                    role: normalizeRoleLabel(user.role),
                    profile_photo: user.profile_photo,
                    must_change_password: Boolean(user.must_change_password),
                    offline_pin_enrolled: device.pinEnrolled,
                    offline_account_pin_enrolled: device.accountPinEnrolled,
                    offline_pin_setup_required: Boolean(user.offline_pin_setup_required),
                    device_id: device.deviceId,
                },
                preferences
            }
        });

    } catch (err) {
        const logger = require('../services/logger');

        logger.error('Login error', err);

        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};

const changeForcedPassword = async (req, res) => {
    try {
        await ensureUserManagementSchema();
        const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
        const passwordCheck = validatePassword(newPassword);
        if (!passwordCheck.valid) {
            return res.status(400).json({
                success: false,
                message: passwordCheck.message,
                errorCode: 'VALIDATION_ERROR',
                requirements: passwordCheck.requirements,
            });
        }

        const [rows] = await pool.query(
            'SELECT user_id, full_name, username, role, profile_photo, password, must_change_password, offline_pin_setup_required, offline_pin_hash, offline_pin_version, token_version FROM users WHERE user_id = ? LIMIT 1',
            [req.user.user_id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Account not found.' });
        const user = rows[0];
        if (!user.must_change_password) {
            return res.status(400).json({ success: false, message: 'A forced password change is not pending.' });
        }
        if (await bcrypt.compare(newPassword, user.password)) {
            return res.status(400).json({
                success: false,
                message: 'Choose a password different from your temporary password.',
                errorCode: 'PASSWORD_UNCHANGED',
            });
        }

        const connection = await pool.getConnection();
        let tokenVersion;
        try {
            await connection.beginTransaction();
            await connection.query(
                `UPDATE users SET password = ?, must_change_password = 0, password_changed_at = UTC_TIMESTAMP(),
                  temp_password_expires_at = NULL, failed_login_attempts = 0, locked_until = NULL,
                  token_version = token_version + 1, updated_at = UTC_TIMESTAMP() WHERE user_id = ?`,
                [await bcrypt.hash(newPassword, 10), user.user_id]
            );
            await connection.query(
                "UPDATE user_login_history SET status = 'REVOKED', ended_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'ACTIVE'",
                [user.user_id]
            );
            const [versionRows] = await connection.query('SELECT token_version FROM users WHERE user_id = ?', [user.user_id]);
            tokenVersion = Number(versionRows[0].token_version);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        const sessionId = crypto.randomBytes(24).toString('hex');
        const token = jwt.sign({
            user_id: user.user_id,
            username: user.username,
            role: normalizeRoleLabel(user.role),
            token_version: tokenVersion,
            device_id: req.user.device_id,
            jti: sessionId,
        }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
        const expiration = jwt.decode(token)?.exp;
        const [deviceRows] = await pool.query(
            "SELECT pin_hash, pin_version FROM offline_devices WHERE device_id = ? AND user_id = ? AND status = 'ACTIVE' LIMIT 1",
            [req.user.device_id, user.user_id]
        );
        await recordLoginHistory({
            userId: user.user_id,
            sessionId,
            status: 'ACTIVE',
            req,
            expiresAt: expiration ? new Date(expiration * 1000) : null,
        });
        await logAudit({
            actorId: user.user_id,
            user_id: user.user_id,
            action: 'PASSWORD_CHANGED',
            module: 'auth',
            description: 'Temporary password replaced at first sign-in.',
            table_name: 'users',
            record_id: user.user_id,
            targetType: 'user',
            targetId: user.user_id,
            targetLabel: `@${user.username}`,
            result: 'success',
            new_data: { must_change_password: false, sessions_revoked: true },
            req,
        });
        return res.json({
            success: true,
            message: 'Password updated successfully.',
            data: {
                token,
                user: {
                    user_id: user.user_id,
                    full_name: user.full_name,
                    username: user.username,
                    role: normalizeRoleLabel(user.role),
                    profile_photo: user.profile_photo,
                    must_change_password: false,
                    offline_pin_enrolled: isDevicePinEnrolled({
                        pinHash: deviceRows[0]?.pin_hash,
                        pinVersion: deviceRows[0]?.pin_version,
                        accountPinHash: user.offline_pin_hash,
                        accountPinVersion: user.offline_pin_version,
                    }),
                    offline_account_pin_enrolled: Boolean(user.offline_pin_hash),
                    offline_pin_setup_required: Boolean(user.offline_pin_setup_required),
                    device_id: req.user.device_id,
                },
            },
        });
    } catch (error) {
        const logger = require('../services/logger');
        logger.error('changeForcedPassword error', error);
        return res.status(500).json({ success: false, message: 'Unable to update the password.' });
    }
};


const logout = async (req, res) => {
    try {
        const userId = req.user ? req.user.user_id : null;

        if (req.user?.jti) {
            await pool.query(
                "UPDATE user_login_history SET status = 'LOGGED_OUT', ended_at = NOW() WHERE session_id = ? AND user_id = ? AND status = 'ACTIVE'",
                [req.user.jti, userId]
            );
        }

        await logAudit({
            actorId: userId,
            user_id: userId,
            action: 'LOGOUT',
            module: 'auth',
            description: 'User signed out.',
            result: 'success',
            req,
        });

        // JWT is stateless.
        // Logout is handled client-side by removing the token.
        return res.json({
            success: true,
            message: 'Logged out'
        });

    } catch (err) {
        const logger = require('../services/logger');

        logger.error('Logout error', err);

        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};


const me = async (req, res) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'Not authenticated'
        });
    }

    try {
        await ensureUserPhotoColumn();
        await ensureAccountSecuritySchema();
        await ensureOfflineSecuritySchema();
        const [rows] = await pool.query(
            `SELECT u.user_id, u.full_name, u.username, u.role, u.profile_photo, u.created_at,
                u.offline_pin_setup_required, u.offline_pin_hash, u.offline_pin_version,
                d.pin_hash, d.pin_version
             FROM users u LEFT JOIN offline_devices d
               ON d.user_id = u.user_id AND d.device_id = ? AND d.status = 'ACTIVE'
             WHERE u.user_id = ?`,
            [req.user.device_id, req.user.user_id]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = rows[0];

        return res.json({
            success: true,
            data: {
                user: {
                    ...user,
                    role: normalizeRoleLabel(user.role),
                    is_active: user.is_active !== false,
                    offline_pin_enrolled: isDevicePinEnrolled({
                        pinHash: user.pin_hash,
                        pinVersion: user.pin_version,
                        accountPinHash: user.offline_pin_hash,
                        accountPinVersion: user.offline_pin_version,
                    }),
                    offline_account_pin_enrolled: Boolean(user.offline_pin_hash),
                    offline_pin_setup_required: Boolean(user.offline_pin_setup_required),
                }
            }
        });

    } catch (err) {
        const logger = require('../services/logger');

        logger.error('Me endpoint error', err);

        return res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
};


module.exports = {
    login,
    me,
    logout,
    changeForcedPassword
};