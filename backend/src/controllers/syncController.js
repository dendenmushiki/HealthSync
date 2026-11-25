const crypto = require('crypto');
const {
  processOperation,
  findIdempotency,
  markIdempotencyRejected,
  ensureIdempotencyTable,
  getPrimaryKeyColumn,
  validateTableName,
} = require('../services/syncService');
const pool = require('../config/database');
const logger = require('../services/logger');

function getRequestFingerprint({ operation, module, table, payload }) {
  return crypto.createHash('sha256')
    .update(`${operation}|${module || ''}|${table}|${JSON.stringify(payload || {})}`)
    .digest('hex');
}

function getClientCreatedAt(req) {
  const value = String(req.get('X-HealthSync-Client-Created-At') || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function readStoredResponse(record) {
  if (!record?.response) return null;
  if (typeof record.response === 'object') return record.response;
  try {
    return JSON.parse(record.response);
  } catch {
    return null;
  }
}

const handleSync = async (req, res) => {
  let idempotencyContext = null;
  try {
    const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotencyKey;
    if (!idempotencyKey) return res.status(400).json({ success: false, message: 'Missing idempotency key' });

    const { operation, module, table, payload } = req.body;
    if (!operation || !table) return res.status(400).json({ success: false, message: 'Invalid sync payload' });

    const userId = req.user?.user_id;
    const offlineSync = String(req.get('X-HealthSync-Offline-Sync') || '').toLowerCase() === 'true';
    const clientCreatedAt = getClientCreatedAt(req);
    const requestFingerprint = getRequestFingerprint({ operation, module, table, payload });
    idempotencyContext = { key: idempotencyKey, ownerId: userId, requestFingerprint };
    const cachedResponse = (record) => {
      const metadata = readStoredResponse(record);
      if (metadata?.ownerId !== String(userId)) {
        return res.status(409).json({
          success: false,
          message: 'This synchronization result cannot be verified for the current account.',
          errorCode: 'IDEMPOTENCY_KEY_CONFLICT',
        });
      }
      if (metadata.requestFingerprint !== requestFingerprint) {
        return res.status(409).json({
          success: false,
          message: 'This idempotency key was already used for a different request.',
          errorCode: 'IDEMPOTENCY_KEY_REUSE',
        });
      }
      if (metadata.outcome === 'REJECTED') {
        return res.status(409).json({
          success: false,
          message: 'The previous attempt was rejected. Review the saved change before submitting a corrected operation.',
          errorCode: 'IDEMPOTENCY_REJECTED',
        });
      }
      if (metadata.outcome !== 'SUCCESS' || !metadata.response) {
        return res.status(409).json({
          success: false,
          message: 'The server outcome for this change is unknown. Verify whether it was saved before retrying.',
          errorCode: 'IDEMPOTENCY_OUTCOME_UNKNOWN',
        });
      }
      return res.json({ success: true, data: metadata.response });
    };

    const existing = await findIdempotency(idempotencyKey);
    if (existing) return cachedResponse(existing);

    const ip = req.ip;
    const userAgent = req.get('User-Agent');
    const result = await processOperation({
      idempotencyKey,
      operation,
      module,
      table,
      payload,
      userId,
      ip,
      userAgent,
      requestFingerprint,
      offlineSync,
      clientCreatedAt,
    });
    if (result.fromCache) {
      return cachedResponse(result.record);
    }
    return res.json({ success: true, data: result.response });
  } catch (err) {
    if (err && err.name === 'ValidationError') {
      if (idempotencyContext) {
        try {
          await markIdempotencyRejected(idempotencyContext);
        } catch (storageError) {
          logger.error('Could not record a rejected sync operation', {
            errorCode: storageError?.code || 'IDEMPOTENCY_STORAGE_ERROR',
          });
          return res.status(500).json({
            success: false,
            message: 'Synchronization validation could not be recorded. The saved change was retained for safe review.',
            errorCode: 'SYNC_FAILED',
          });
        }
      }
      return res.status(400).json({ success: false, errors: err.errors });
    }
    logger.error('Sync request failed', { errorCode: err?.code || 'SYNC_FAILED' });
    return res.status(500).json({
      success: false,
      message: 'Synchronization failed. The saved change was retained for safe review.',
      errorCode: 'SYNC_FAILED',
    });
  }
};

const listSyncActivity = async (req, res) => {
  try {
    const scope = String(req.query.scope || 'all').toLowerCase();
    if (!['mine', 'all'].includes(scope)) {
      return res.status(400).json({ success: false, message: 'Invalid synced history account filter.' });
    }
    await ensureIdempotencyTable();
    const [items] = await pool.query(`
      SELECT idempotency.id AS sync_activity_id, idempotency.table_name, idempotency.operation,
        idempotency.server_record_id, idempotency.created_at,
        users.user_id AS actor_id,
        users.full_name AS actor_name
      FROM sync_idempotency AS idempotency
      JOIN users ON users.user_id = CAST(
        JSON_UNQUOTE(JSON_EXTRACT(idempotency.response, '$.ownerId')) AS UNSIGNED
      )
      WHERE idempotency.status = 'SUCCESS'
        AND JSON_UNQUOTE(JSON_EXTRACT(idempotency.response, '$.outcome')) = 'SUCCESS'
        AND JSON_UNQUOTE(JSON_EXTRACT(idempotency.response, '$.offlineSync')) = 'true'
        AND idempotency.server_record_id IS NOT NULL
        AND LOWER(users.role) = 'bhw'
        ${scope === 'mine' ? 'AND users.user_id = ?' : ''}
      ORDER BY idempotency.created_at DESC
      LIMIT 50
    `, scope === 'mine' ? [req.user.user_id] : []);
    return res.json({ success: true, data: { items } });
  } catch (error) {
    logger.error('Could not load shared sync activity', {
      errorCode: error?.code || 'SYNC_ACTIVITY_LOAD_FAILED',
    });
    return res.status(500).json({ success: false, message: 'Shared sync activity is unavailable.' });
  }
};

const getSyncActivityDetails = async (req, res) => {
  try {
    if (!/^\d+$/.test(String(req.params.id))) {
      return res.status(400).json({ success: false, message: 'Invalid synced activity ID.' });
    }

    await ensureIdempotencyTable();
    const [activityRows] = await pool.query(`
      SELECT idempotency.id AS sync_activity_id, idempotency.table_name,
        idempotency.operation, idempotency.server_record_id, idempotency.created_at,
        users.user_id AS actor_id, users.full_name AS actor_name
      FROM sync_idempotency AS idempotency
      JOIN users ON users.user_id = CAST(
        JSON_UNQUOTE(JSON_EXTRACT(idempotency.response, '$.ownerId')) AS UNSIGNED
      )
      WHERE idempotency.id = ?
        AND idempotency.status = 'SUCCESS'
        AND JSON_UNQUOTE(JSON_EXTRACT(idempotency.response, '$.outcome')) = 'SUCCESS'
        AND JSON_UNQUOTE(JSON_EXTRACT(idempotency.response, '$.offlineSync')) = 'true'
        AND idempotency.server_record_id IS NOT NULL
        AND LOWER(users.role) = 'bhw'
      LIMIT 1
    `, [req.params.id]);

    if (!activityRows.length) {
      return res.status(404).json({ success: false, message: 'Synced activity was not found.' });
    }

    const activity = activityRows[0];
    if (!validateTableName(activity.table_name)) {
      return res.status(404).json({ success: false, message: 'Synced record details are unavailable.' });
    }

    const primaryKey = await getPrimaryKeyColumn(activity.table_name);
    if (!primaryKey || !/^[a-zA-Z0-9_]+$/.test(primaryKey)) {
      logger.error('Could not resolve the primary key for a synced record', {
        table: activity.table_name,
        errorCode: 'SYNC_ACTIVITY_PRIMARY_KEY_UNAVAILABLE',
      });
      return res.status(500).json({ success: false, message: 'Synced record details are unavailable.' });
    }

    const [recordRows] = await pool.query(
      `SELECT * FROM \`${activity.table_name}\` WHERE \`${primaryKey}\` = ? LIMIT 1`,
      [activity.server_record_id]
    );
    return res.json({
      success: true,
      data: {
        ...activity,
        record_details: recordRows[0] || null,
      },
    });
  } catch (error) {
    logger.error('Could not load synced record details', {
      errorCode: error?.code || 'SYNC_ACTIVITY_DETAILS_LOAD_FAILED',
    });
    return res.status(500).json({ success: false, message: 'Synced record details are unavailable.' });
  }
};

module.exports = { handleSync, listSyncActivity, getSyncActivityDetails };
