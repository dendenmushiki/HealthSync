const { AsyncLocalStorage } = require('async_hooks');
const pool = require('../config/database');

const requestContext = new AsyncLocalStorage();
const SECRET_KEY = /(password|passwd|passphrase|hash|token|secret|authorization|cookie|credential|api.?key|private.?key)/i;
const MAX_METADATA_BYTES = 48 * 1024;

const sanitizeAuditData = (value, key = '') => {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^\$2[aby]\$\d{2}\$/.test(value) || /^Bearer\s+\S+/i.test(value) || /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(value)) {
      return '[REDACTED]';
    }
    return value.replace(/\b(password|passwd|token|secret|hash|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]').slice(0, 8000);
  }
  if (Array.isArray(value)) return value.slice(0, 500).map((entry) => sanitizeAuditData(entry));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 500).map(([childKey, childValue]) => [
      childKey,
      SECRET_KEY.test(childKey) ? '[REDACTED]' : sanitizeAuditData(childValue, childKey),
    ]));
  }
  return String(value).slice(0, 8000);
};

const limitAuditData = (value) => {
  const safe = sanitizeAuditData(value);
  if (safe === null || safe === undefined) return null;
  if (Buffer.byteLength(JSON.stringify(safe), 'utf8') <= MAX_METADATA_BYTES) return safe;
  return { truncated: true, message: 'Audit data omitted because it exceeded the safe size limit.' };
};

const runWithAuditContext = (req, res, next) => requestContext.run({
  ip_address: req.ip || req.socket?.remoteAddress || null,
  user_agent: String(req.get('user-agent') || '').slice(0, 255) || null,
}, next);

const logAudit = async ({
  actorId,
  user_id = null,
  action,
  module = null,
  description = null,
  table_name = null,
  record_id = null,
  targetType = null,
  target_type = null,
  targetId = null,
  target_id = null,
  targetLabel = null,
  target_label = null,
  old_data = null,
  new_data = null,
  metadata = null,
  ip,
  ip_address = null,
  userAgent,
  user_agent = null,
  result,
  severity,
  status = 'SUCCESS',
  req,
}) => {
  const context = req
    ? { ip_address: req.ip || req.socket?.remoteAddress || null, user_agent: String(req.get?.('user-agent') || '').slice(0, 255) || null }
    : requestContext.getStore() || {};
  const actualActorId = actorId !== undefined ? actorId : user_id;
  const actualTargetId = targetId !== undefined ? targetId : (target_id !== undefined ? target_id : record_id);
  const finalStatus = String(status || '').toUpperCase() === 'FAILED' ? 'FAILED' : 'SUCCESS';
  const finalResult = result || (finalStatus === 'FAILED' || String(action).toUpperCase() === 'LOGIN_FAILED' ? 'failure' : 'success');
  const finalSeverity = severity || (['failure', 'warning', 'critical'].includes(finalResult) || ['LOGIN_FAILED', 'ACCOUNT_LOCKED', 'PASSWORD_RESET', 'ROLE_CHANGED'].includes(String(action).toUpperCase()) ? 'warning' : 'info');
  const safeOld = limitAuditData(old_data);
  const safeNew = limitAuditData(new_data);
  const safeMetadata = sanitizeAuditData({ ...(metadata && typeof metadata === 'object' ? metadata : {}), ...(safeOld !== null ? { old_data: safeOld } : {}), ...(safeNew !== null ? { new_data: safeNew } : {}) });
  let metadataJson = safeMetadata && Object.keys(safeMetadata).length ? JSON.stringify(safeMetadata) : null;
  if (metadataJson && Buffer.byteLength(metadataJson, 'utf8') > MAX_METADATA_BYTES) {
    metadataJson = JSON.stringify({ truncated: true, message: 'Audit metadata omitted because it exceeded the safe size limit.' });
  }
  const safeDescription = sanitizeAuditData(description);
  const sourceIp = ip || ip_address || context.ip_address || null;
  const sourceAgent = userAgent || user_agent || context.user_agent || null;
  const values = [
    user_id ?? actualActorId ?? null,
    String(action || 'unknown').slice(0, 50),
    String(module || 'system').slice(0, 100),
    safeDescription ? String(safeDescription).slice(0, 8000) : null,
    table_name,
    record_id,
    safeOld === null ? null : JSON.stringify(safeOld),
    safeNew === null ? null : JSON.stringify(safeNew),
    sourceIp ? String(sourceIp).slice(0, 45) : null,
    sourceAgent ? String(sourceAgent).slice(0, 255) : null,
    finalStatus,
    actualActorId ?? null,
    targetType || target_type || (actualTargetId !== null && actualTargetId !== undefined ? table_name : null),
    actualTargetId === null || actualTargetId === undefined ? null : String(actualTargetId).slice(0, 64),
    String(sanitizeAuditData(targetLabel || target_label || '') || '').slice(0, 150) || null,
    finalResult,
    ['info', 'warning', 'critical'].includes(finalSeverity) ? finalSeverity : 'info',
    metadataJson,
  ];

  try {
    await pool.query(
      `INSERT INTO audit_logs
       (user_id, action, module, description, table_name, record_id, old_data, new_data, ip_address, user_agent, status,
        actor_id, target_type, target_id, target_label, result, severity, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values
    );
    return true;
  } catch (error) {
    const logger = require('./logger');
    logger.error('Failed to write audit log', { code: error.code || 'AUDIT_WRITE_FAILED' });
    return false;
  }
};

module.exports = {
  logAudit,
  writeAudit: logAudit,
  sanitizeAuditData,
  runWithAuditContext,
};
