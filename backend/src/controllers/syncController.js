const crypto = require('crypto');
const {
  processOperation,
  findIdempotency,
  markIdempotencyRejected,
  ensureIdempotencyTable,
} = require('../services/syncService');
const pool = require('../config/database');
const logger = require('../services/logger');

function getRequestFingerprint({ operation, module, table, payload }) {
  return crypto.createHash('sha256')
    .update(`${operation}|${module || ''}|${table}|${JSON.stringify(payload || {})}`)
    .digest('hex');
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
    await ensureIdempotencyTable();
    const [items] = await pool.query(`
      SELECT idempotency.table_name, idempotency.operation,
        idempotency.server_record_id, idempotency.created_at,
        users.full_name AS actor_name
      FROM sync_idempotency AS idempotency
      JOIN users ON users.user_id = CAST(
        JSON_UNQUOTE(JSON_EXTRACT(idempotency.response, '$.ownerId')) AS UNSIGNED
      )
      WHERE idempotency.status = 'SUCCESS'
        AND JSON_UNQUOTE(JSON_EXTRACT(idempotency.response, '$.outcome')) = 'SUCCESS'
        AND idempotency.server_record_id IS NOT NULL
        AND LOWER(users.role) = 'bhw'
      ORDER BY idempotency.created_at DESC
      LIMIT 50
    `);
    return res.json({ success: true, data: { items } });
  } catch (error) {
    logger.error('Could not load shared sync activity', {
      errorCode: error?.code || 'SYNC_ACTIVITY_LOAD_FAILED',
    });
    return res.status(500).json({ success: false, message: 'Shared sync activity is unavailable.' });
  }
};

module.exports = { handleSync, listSyncActivity };
