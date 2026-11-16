const crypto = require('crypto');
const pool = require('../config/database');
const logger = require('../services/logger');
const { ensureIdempotencyTable, findIdempotency } = require('../services/syncService');

const ID_COLUMN_BY_TABLE = {
  residents: ['resident_id', 'id'],
  health_records: ['health_record_id', 'id'],
  child_health_records: ['id'],
  operation_timbang: ['operation_timbang_id', 'timbang_id', 'id'],
  adult_bmi_records: ['bmi_id', 'record_id', 'id'],
  adolescent_bmi_records: ['adolescent_bmi_id', 'record_id', 'id'],
  senior_citizen_records: ['senior_id', 'record_id', 'id'],
  patient_clinical_records: ['id'],
  child_records: ['id'],
  maternal_records: ['id'],
  immunization_records: ['id'],
  report_remarks: [],
};

function getResponseRecordId(body, req) {
  const data = body?.data;
  const record = data?.record || data;
  const keys = ID_COLUMN_BY_TABLE[req.idempotencyTable] || ['id'];
  for (const key of ['serverRecordId', ...keys]) {
    if (data?.[key] !== undefined && data[key] !== null) return data[key];
    if (record?.[key] !== undefined && record[key] !== null) return record[key];
  }
  return req.params?.recordId || req.params?.id || null;
}

function readMetadata(row) {
  if (!row?.response) return null;
  if (typeof row.response === 'object') return row.response;
  try {
    return JSON.parse(row.response);
  } catch {
    return null;
  }
}

function conflict(res, message, errorCode) {
  return res.status(409).json({ success: false, message, errorCode });
}

function createIdempotencyMiddleware(moduleName, tableName) {
  return async (req, res, next) => {
    const key = String(req.get('X-Idempotency-Key') || '').trim();
    if (!key) return next();
    if (!/^[\da-f-]{36}$/i.test(key)) {
      return res.status(400).json({ success: false, message: 'Invalid idempotency key.' });
    }
    if (!req.user?.user_id) {
      return res.status(401).json({ success: false, message: 'Authentication is required.' });
    }

    const resolvedModule = typeof moduleName === 'function' ? moduleName(req) : moduleName;
    const resolvedTable = typeof tableName === 'function' ? tableName(req) : tableName;
    if (!resolvedTable) {
      return res.status(400).json({ success: false, message: 'Unsupported idempotent operation.' });
    }
    req.idempotencyTable = resolvedTable;
    const ownerId = String(req.user.user_id);
    const requestFingerprint = crypto.createHash('sha256')
      .update(`${req.method}|${req.baseUrl}${req.path}|${JSON.stringify(req.body || {})}`)
      .digest('hex');

    try {
      await ensureIdempotencyTable();
      let existing = await findIdempotency(key);
      if (existing) {
        const metadata = readMetadata(existing);
        if (metadata?.ownerId !== ownerId) {
          return conflict(res, 'This idempotency key is not available to the current account.', 'IDEMPOTENCY_KEY_CONFLICT');
        }
        if (metadata.requestFingerprint !== requestFingerprint) {
          return conflict(res, 'This idempotency key was already used for a different request.', 'IDEMPOTENCY_KEY_REUSE');
        }
        if (existing.status === 'SUCCESS' && metadata.outcome === 'SUCCESS') {
          return res.json({
            success: true,
            data: { serverRecordId: existing.server_record_id, cached: true },
          });
        }
        if (existing.status === 'FAILED' && metadata.outcome === 'REJECTED') {
          return conflict(res, 'The previous attempt was rejected. Review the saved change before retrying.', 'IDEMPOTENCY_REJECTED');
        }
        return conflict(
          res,
          'The server outcome for this change is unknown. Verify whether it was saved before retrying.',
          'IDEMPOTENCY_OUTCOME_UNKNOWN'
        );
      }

      const pendingMetadata = {
        ownerId,
        requestFingerprint,
        outcome: 'PENDING',
      };
      await pool.query(
        'INSERT INTO sync_idempotency (idempotency_key, module_name, table_name, operation, response, status) VALUES (?, ?, ?, ?, ?, ?)',
        [key, resolvedModule, resolvedTable, req.method, JSON.stringify(pendingMetadata), 'PENDING']
      );

      const originalJson = res.json.bind(res);
      let responseRecorded = false;
      res.json = (body) => {
        if (responseRecorded) return originalJson(body);
        responseRecorded = true;
        const statusCode = Number(res.statusCode) || 200;
        const outcome = statusCode >= 500 ? 'UNKNOWN' : statusCode >= 400 ? 'REJECTED' : 'SUCCESS';
        const metadata = { ownerId, requestFingerprint, outcome };
        const serverRecordId = outcome === 'SUCCESS' ? getResponseRecordId(body, req) : null;
        const status = outcome === 'UNKNOWN' ? 'PENDING' : outcome;
        return pool.query(
          'UPDATE sync_idempotency SET server_record_id = ?, response = ?, status = ? WHERE idempotency_key = ? AND status = ?',
          [serverRecordId, JSON.stringify(metadata), status, key, 'PENDING']
        ).catch((error) => {
          logger.error('Failed to persist an idempotent response', {
            errorCode: error?.code || 'IDEMPOTENCY_STORAGE_ERROR',
          });
        }).then(() => originalJson(body));
      };
      return next();
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        const raced = await findIdempotency(key);
        const metadata = readMetadata(raced);
        if (metadata?.ownerId === ownerId && metadata.requestFingerprint === requestFingerprint &&
            raced?.status === 'SUCCESS' && metadata.outcome === 'SUCCESS') {
          return res.json({ success: true, data: { serverRecordId: raced.server_record_id, cached: true } });
        }
        return conflict(
          res,
          'Another synchronization attempt is already processing this change.',
          'IDEMPOTENCY_OUTCOME_UNKNOWN'
        );
      }
      logger.error('Could not establish idempotent request protection', {
        errorCode: error?.code || 'IDEMPOTENCY_STORAGE_ERROR',
      });
      return next(error);
    }
  };
}

module.exports = createIdempotencyMiddleware;
