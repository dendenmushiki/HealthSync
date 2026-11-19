const crypto = require('crypto');
const pool = require('../config/database');

let schemaPromise;

const ensureOfflineSecuritySchema = async () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const additions = [
        ['offline_pin_setup_required', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ['offline_pin_hash', 'VARCHAR(100) NULL'],
        ['offline_pin_version', 'INT NOT NULL DEFAULT 0'],
      ];
      for (const [name, definition] of additions) {
        const [columns] = await pool.query('SHOW COLUMNS FROM users LIKE ?', [name]);
        if (!columns.length) await pool.query(`ALTER TABLE users ADD COLUMN \`${name}\` ${definition}`);
      }

      await pool.query(`
        CREATE TABLE IF NOT EXISTS offline_devices (
          device_id CHAR(36) NOT NULL,
          user_id INT NOT NULL,
          public_key TEXT NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
          pin_hash VARCHAR(100) NULL,
          pin_version INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at DATETIME NULL,
          revoked_at DATETIME NULL,
          revoked_by INT NULL,
          PRIMARY KEY (user_id, device_id),
          KEY idx_offline_devices_user (user_id, status)
        )
      `);
      const [primaryIndexRows] = await pool.query("SHOW INDEX FROM offline_devices WHERE Key_name = 'PRIMARY'");
      const primaryColumns = primaryIndexRows
        .sort((left, right) => left.Seq_in_index - right.Seq_in_index)
        .map((row) => row.Column_name);
      if (primaryColumns.length === 1 && primaryColumns[0] === 'device_id') {
        await pool.query('ALTER TABLE offline_devices DROP PRIMARY KEY, ADD PRIMARY KEY (user_id, device_id)');
      }
      const [devicePinColumns] = await pool.query("SHOW COLUMNS FROM offline_devices LIKE 'pin_hash'");
      if (!devicePinColumns.length) {
        await pool.query('ALTER TABLE offline_devices ADD COLUMN pin_hash VARCHAR(100) NULL');
      }
      const [devicePinVersionColumns] = await pool.query("SHOW COLUMNS FROM offline_devices LIKE 'pin_version'");
      if (!devicePinVersionColumns.length) {
        await pool.query('ALTER TABLE offline_devices ADD COLUMN pin_version INT NOT NULL DEFAULT 0');
      }
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
};

const isValidDeviceId = (deviceId) => (
  typeof deviceId === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)
);

const isDevicePinEnrolled = ({ pinHash, pinVersion, accountPinHash, accountPinVersion }) => (
  accountPinHash
    ? Number(pinVersion) > 0 && Number(pinVersion) === Number(accountPinVersion)
    : Boolean(pinHash)
);

const verifyDeviceSignature = (publicKey, message, signature) => {
  if (typeof publicKey !== 'string' || typeof message !== 'string' || typeof signature !== 'string') return false;
  try {
    return crypto.verify(
      'sha256',
      Buffer.from(message, 'utf8'),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64')
    );
  } catch (error) {
    return false;
  }
};

const registerOrCheckDevice = async ({ userId, deviceId, publicKey, challenge, signature }) => {
  await ensureOfflineSecuritySchema();
  if (!isValidDeviceId(deviceId) || typeof publicKey !== 'string' || publicKey.length > 2048 ||
      typeof challenge !== 'string' || challenge.length < 24 || challenge.length > 128 ||
      !verifyDeviceSignature(publicKey, challenge, signature)) {
    return { ok: false, code: 'INVALID_DEVICE' };
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [lockedUsers] = await connection.query(
      'SELECT user_id, offline_pin_hash FROM users WHERE user_id = ? FOR UPDATE',
      [userId]
    );
    if (!lockedUsers.length) {
      await connection.rollback();
      return { ok: false, code: 'INVALID_DEVICE' };
    }
    const accountPinEnrolled = Boolean(lockedUsers[0].offline_pin_hash);
    const [existing] = await connection.query(
      `SELECT d.user_id, d.public_key, d.status, d.pin_hash, d.pin_version,
          u.offline_pin_hash, u.offline_pin_version
       FROM offline_devices d JOIN users u ON u.user_id = d.user_id
       WHERE d.user_id = ? AND d.device_id = ? LIMIT 1`,
      [userId, deviceId]
    );
    if (existing.length) {
      const device = existing[0];
      if (String(device.user_id) !== String(userId) || device.public_key !== publicKey) {
        await connection.rollback();
        return { ok: false, code: 'DEVICE_MISMATCH' };
      }
      if (device.status !== 'ACTIVE') {
        await connection.rollback();
        return { ok: false, code: device.status === 'REVOKED' ? 'DEVICE_REVOKED' : 'DEVICE_ENROLLMENT_REQUIRED' };
      }
      await connection.query('UPDATE offline_devices SET last_seen_at = UTC_TIMESTAMP() WHERE user_id = ? AND device_id = ?', [userId, deviceId]);
      await connection.commit();
      const hasAccountPin = Boolean(device.offline_pin_hash);
      return {
        ok: true,
        deviceId,
        pinEnrolled: isDevicePinEnrolled({
          pinHash: device.pin_hash,
          pinVersion: device.pin_version,
          accountPinHash: device.offline_pin_hash,
          accountPinVersion: device.offline_pin_version,
        }),
        accountPinEnrolled: hasAccountPin,
      };
    }

    const [devices] = await connection.query('SELECT device_id FROM offline_devices WHERE user_id = ? LIMIT 1', [userId]);
    const status = devices.length ? 'PENDING' : 'ACTIVE';
    await connection.query(
      'INSERT INTO offline_devices (device_id, user_id, public_key, status, last_seen_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())',
      [deviceId, userId, publicKey, status]
    );
    await connection.commit();
    return {
      ok: status === 'ACTIVE',
      code: status === 'PENDING' ? 'DEVICE_ENROLLMENT_REQUIRED' : null,
      deviceId,
      pinEnrolled: false,
      accountPinEnrolled,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const verifyDeviceProof = async ({ userId, deviceId, message, signature }) => {
  await ensureOfflineSecuritySchema();
  if (!isValidDeviceId(deviceId) || typeof message !== 'string' || message.length > 512) return false;
  const [devices] = await pool.query(
    "SELECT public_key FROM offline_devices WHERE device_id = ? AND user_id = ? AND status = 'ACTIVE' LIMIT 1",
    [deviceId, userId]
  );
  return devices.length > 0 && verifyDeviceSignature(devices[0].public_key, message, signature);
};

const checkDeviceAuthorization = async ({ userId, deviceId, message, signature }) => {
  await ensureOfflineSecuritySchema();
  if (!/^\d+$/.test(String(userId ?? '')) || !isValidDeviceId(deviceId) || typeof message !== 'string' || message.length < 24 ||
      message.length > 128 || typeof signature !== 'string' || signature.length > 256) {
    return { ok: false, code: 'DEVICE_REVOKED' };
  }
  const [rows] = await pool.query(
    `SELECT d.public_key, d.status, d.pin_hash, d.pin_version,
        u.is_active, u.offline_pin_hash, u.offline_pin_version
     FROM offline_devices d
     JOIN users u ON u.user_id = d.user_id
     WHERE d.device_id = ? AND d.user_id = ? LIMIT 1`,
    [deviceId, userId]
  );
  if (!rows.length || !verifyDeviceSignature(rows[0].public_key, message, signature)) {
    return { ok: false, code: 'DEVICE_REVOKED' };
  }
  if (rows[0].is_active === false || Number(rows[0].is_active) === 0) {
    return { ok: false, code: 'ACCOUNT_DEACTIVATED' };
  }
  if (rows[0].status !== 'ACTIVE') return { ok: false, code: 'DEVICE_REVOKED' };
  await pool.query(
    'UPDATE offline_devices SET last_seen_at = UTC_TIMESTAMP() WHERE user_id = ? AND device_id = ?',
    [userId, deviceId]
  );
  return {
    ok: true,
    pinEnrolled: isDevicePinEnrolled({
      pinHash: rows[0].pin_hash,
      pinVersion: rows[0].pin_version,
      accountPinHash: rows[0].offline_pin_hash,
      accountPinVersion: rows[0].offline_pin_version,
    }),
    accountPinEnrolled: Boolean(rows[0].offline_pin_hash),
  };
};

const listUserDevices = async (userId) => {
  await ensureOfflineSecuritySchema();
  const [rows] = await pool.query(
    'SELECT device_id, status, created_at, last_seen_at, revoked_at FROM offline_devices WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
  return rows;
};

const revokeUserDevice = async ({ userId, deviceId, revokedBy = userId }) => {
  await ensureOfflineSecuritySchema();
  const [result] = await pool.query(
    "UPDATE offline_devices SET status = 'REVOKED', revoked_at = UTC_TIMESTAMP(), revoked_by = ? WHERE user_id = ? AND device_id = ? AND status <> 'REVOKED'",
    [revokedBy, userId, deviceId]
  );
  return result.affectedRows > 0;
};

const approveUserDevice = async ({ userId, deviceId }) => {
  await ensureOfflineSecuritySchema();
  const [result] = await pool.query(
    "UPDATE offline_devices SET status = 'ACTIVE', revoked_at = NULL, revoked_by = NULL WHERE user_id = ? AND device_id = ? AND status = 'PENDING'",
    [userId, deviceId]
  );
  return result.affectedRows > 0;
};

module.exports = {
  ensureOfflineSecuritySchema,
  isDevicePinEnrolled,
  isValidDeviceId,
  registerOrCheckDevice,
  verifyDeviceProof,
  verifyDeviceSignature,
  checkDeviceAuthorization,
  listUserDevices,
  revokeUserDevice,
  approveUserDevice,
};
