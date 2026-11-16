const pool = require('../config/database');
const logger = require('../services/logger');
const { logAudit, sanitizeAuditData } = require('../services/auditService');
const configuredUnusualStart = Number(process.env.AUDIT_UNUSUAL_HOURS_START);
const configuredUnusualEnd = Number(process.env.AUDIT_UNUSUAL_HOURS_END);
const unusualStartHour = Number.isInteger(configuredUnusualStart) && configuredUnusualStart >= 0 && configuredUnusualStart <= 23
  ? configuredUnusualStart : 22;
const unusualEndHour = Number.isInteger(configuredUnusualEnd) && configuredUnusualEnd >= 0 && configuredUnusualEnd <= 23 && configuredUnusualEnd !== unusualStartHour
  ? configuredUnusualEnd : 5;
const unusualHourPredicate = unusualStartHour < unusualEndHour
  ? `(HOUR(al.created_at) >= ${unusualStartHour} AND HOUR(al.created_at) < ${unusualEndHour})`
  : `(HOUR(al.created_at) >= ${unusualStartHour} OR HOUR(al.created_at) < ${unusualEndHour})`;

const CATEGORY_MODULES = {
  authentication: ['auth'],
  user_management: ['users'],
  resident: ['residents'],
  health_record: ['health_records', 'child_health_records', 'clinical', 'child', 'maternal', 'immunization'],
  nutrition: ['operation_timbang', 'adolescent_bmi', 'adult_bmi'],
  senior_registry: ['senior_citizens'],
  settings: ['account-settings', 'admin-settings'],
  reports: ['reports'],
  sync: ['sync'],
  system: ['system'],
};

const toList = (value) => {
  if (Array.isArray(value)) return value.flatMap((entry) => String(entry).split(',')).map((entry) => entry.trim()).filter(Boolean);
  return String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
};

const dateToManilaSql = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${text} 00:00:00`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map(({ type, value: partValue }) => [type, partValue]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
};

const isUnsignedIntegerSql = (expression) => `CAST(${expression} AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci REGEXP '^[0-9]+$'`;

const validateDateRange = (query) => {
  const rawFrom = String(query.from || query.startDate || '');
  const rawTo = String(query.to || query.endDate || '');
  const from = dateToManilaSql(rawFrom);
  const to = dateToManilaSql(rawTo);
  if ((rawFrom && !from) || (rawTo && !to)) return 'Enter a valid date range.';
  if (from && to && from > to) return 'From date must be on or before To date.';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (rawTo && (/^\d{4}-\d{2}-\d{2}$/.test(rawTo) ? rawTo > today : new Date(rawTo).getTime() > Date.now())) {
    return 'To date cannot be in the future.';
  }
  return '';
};

const buildFilters = (query = {}, alias = 'al') => {
  const clauses = ['1 = 1'];
  const params = [];
  const actions = toList(query.actions || query.action).slice(0, 100);
  const modules = toList(query.modules || query.module).slice(0, 100);
  const categories = toList(query.category);
  const categoryModules = [...new Set(categories.flatMap((category) => CATEGORY_MODULES[category] || []))];
  const userId = query.userId || query.user_id;
  const targetUserId = query.target_user_id;
  const from = dateToManilaSql(query.from || query.startDate);
  const rawTo = String(query.to || query.endDate || '');
  const to = dateToManilaSql(rawTo);
  const validResult = ['success', 'failure'].includes(String(query.result || '').toLowerCase());
  const validSeverity = ['info', 'warning', 'critical'].includes(String(query.severity || '').toLowerCase());

  if (query.q || query.search) {
    const text = `%${String(query.q || query.search).trim().slice(0, 120)}%`;
    clauses.push(`(
      COALESCE(actor.full_name, '') LIKE ? OR COALESCE(actor.username, '') LIKE ? OR
      COALESCE(target.full_name, '') LIKE ? OR COALESCE(target.username, '') LIKE ? OR
      COALESCE(${alias}.target_label, '') LIKE ? OR ${alias}.action LIKE ? OR ${alias}.module LIKE ? OR
      ${alias}.description LIKE ? OR ${alias}.ip_address LIKE ?
    )`);
    params.push(text, text, text, text, text, text, text, text, text);
  }
  if (actions.length) {
    clauses.push(`${alias}.action IN (${actions.map(() => '?').join(',')})`);
    params.push(...actions.slice(0, 100));
  }
  const selectedModules = modules.length ? modules : categoryModules;
  if (selectedModules.length) {
    clauses.push(`${alias}.module IN (${selectedModules.map(() => '?').join(',')})`);
    params.push(...selectedModules.slice(0, 100));
  }
  if (userId && /^\d+$/.test(String(userId))) {
    clauses.push(`COALESCE(${alias}.actor_id, CASE WHEN UPPER(${alias}.action) = 'LOGIN_FAILED' THEN NULL ELSE ${alias}.user_id END) = ?`);
    params.push(Number(userId));
  }
  if (targetUserId && /^\d+$/.test(String(targetUserId))) {
    clauses.push(`(
      COALESCE(${alias}.target_id, CASE WHEN UPPER(${alias}.action) = 'LOGIN_FAILED'
        THEN CAST(${alias}.user_id AS CHAR) ELSE CAST(${alias}.record_id AS CHAR) END) = ?
      OR COALESCE(${alias}.actor_id, CASE WHEN UPPER(${alias}.action) = 'LOGIN_FAILED' THEN NULL ELSE ${alias}.user_id END) = ?
    )`);
    params.push(String(targetUserId), Number(targetUserId));
  }
  if (from) {
    clauses.push(`${alias}.created_at >= ?`);
    params.push(from);
  }
  if (to) {
    clauses.push(rawTo.includes('T') || rawTo.includes(':')
      ? `${alias}.created_at <= ?`
      : `${alias}.created_at < DATE_ADD(?, INTERVAL 1 DAY)`);
    params.push(to);
  }
  if (validResult) {
    clauses.push(`COALESCE(${alias}.result, CASE WHEN ${alias}.status = 'FAILED' OR UPPER(${alias}.action) = 'LOGIN_FAILED' THEN 'failure' ELSE 'success' END) = ?`);
    params.push(String(query.result).toLowerCase());
  }
  if (validSeverity) {
    clauses.push(`COALESCE(${alias}.severity, CASE
      WHEN UPPER(${alias}.action) IN ('LOGIN_FAILED', 'ACCOUNT_LOCKED', 'PASSWORD_RESET', 'ROLE_CHANGED') THEN 'warning'
      ELSE 'info' END) = ?`);
    params.push(String(query.severity).toLowerCase());
  }

  return { where: clauses.join(' AND '), params, from, to };
};

const auditJoins = `
  FROM audit_logs al
  LEFT JOIN users actor ON actor.user_id =
    COALESCE(al.actor_id, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED' THEN NULL ELSE al.user_id END)
  LEFT JOIN users target ON target.user_id = CASE
    WHEN (UPPER(al.action) = 'LOGIN_FAILED' OR al.module = 'users' OR LOWER(COALESCE(al.target_type, al.table_name, '')) IN ('user', 'users'))
      AND ${isUnsignedIntegerSql(`COALESCE(al.target_id, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED'
        THEN CAST(al.user_id AS CHAR) ELSE CAST(al.record_id AS CHAR) END)`)}
    THEN CAST(COALESCE(al.target_id, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED'
      THEN CAST(al.user_id AS CHAR) ELSE CAST(al.record_id AS CHAR) END) AS UNSIGNED)
    ELSE NULL END
`;

const rowSelect = `
  SELECT al.audit_id, al.user_id,
    COALESCE(al.actor_id, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED' THEN NULL ELSE al.user_id END) AS actor_id,
    actor.full_name AS actor_name, actor.username AS actor_username, actor.role AS actor_role, actor.profile_photo AS actor_photo,
    COALESCE(al.target_id, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED'
      THEN CAST(al.user_id AS CHAR) ELSE CAST(al.record_id AS CHAR) END) AS target_id,
    COALESCE(al.target_type, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED' THEN 'user' ELSE al.table_name END) AS target_type,
    COALESCE(al.target_label, target.full_name, target.username) AS target_label,
    target.user_id AS target_user_id, target.full_name AS target_user_name, target.username AS target_username,
    al.action, al.module, al.description, al.table_name, al.record_id,
    al.old_data, al.new_data, al.metadata, al.ip_address, al.user_agent,
    COALESCE(al.result, CASE WHEN al.status = 'FAILED' OR UPPER(al.action) = 'LOGIN_FAILED' THEN 'failure' ELSE 'success' END) AS result,
    COALESCE(al.severity, CASE
      WHEN UPPER(al.action) IN ('LOGIN_FAILED', 'ACCOUNT_LOCKED', 'PASSWORD_RESET', 'ROLE_CHANGED') THEN 'warning'
      ELSE 'info' END) AS severity,
    al.created_at
  ${auditJoins}
`;

const activityPreviewSelect = `
  SELECT al.audit_id,
    COALESCE(al.actor_id, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED' THEN NULL ELSE al.user_id END) AS actor_id,
    actor.full_name AS actor_name, actor.username AS actor_username, actor.role AS actor_role,
    COALESCE(al.target_id, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED'
      THEN CAST(al.user_id AS CHAR) ELSE CAST(al.record_id AS CHAR) END) AS target_id,
    COALESCE(al.target_type, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED' THEN 'user' ELSE al.table_name END) AS target_type,
    COALESCE(al.target_label, target.full_name, target.username) AS target_label,
    target.user_id AS target_user_id, target.full_name AS target_user_name, target.username AS target_username,
    al.action, al.module, al.description,
    COALESCE(al.result, CASE WHEN al.status = 'FAILED' OR UPPER(al.action) = 'LOGIN_FAILED' THEN 'failure' ELSE 'success' END) AS result,
    COALESCE(al.severity, CASE
      WHEN UPPER(al.action) IN ('LOGIN_FAILED', 'ACCOUNT_LOCKED', 'PASSWORD_RESET', 'ROLE_CHANGED') THEN 'warning'
      ELSE 'info' END) AS severity,
    al.created_at
  ${auditJoins}
`;

const cleanRow = (row) => {
  let description = row.description || '';
  if (String(row.action).toUpperCase() === 'LOGIN_FAILED') {
    const attemptedUsername = row.target_username || (row.target_type === 'username' ? String(row.target_label || '').replace(/^@/, '') : '');
    description = attemptedUsername
      ? `Failed sign-in for @${attemptedUsername}`
      : 'Failed sign-in attempt; the account could not be identified.';
  }
  if (String(row.action).toUpperCase() !== 'LOGIN_FAILED') {
    description = String(description)
      .replace(/\buser\s+#?\d+\b/gi, row.target_label ? `user ${row.target_label}` : 'user account')
      .replace(/\b(?:resident|record)\s+#?\d+\b/gi, row.target_label || 'record');
  }
  const cleanedRow = {
    ...row,
    description: String(description).replace(/(password|passwd|token|secret|hash)\s*[:=]\s*\S+/gi, '$1=[redacted]'),
    actor_role: row.actor_role === 'barangay_official' ? 'official' : row.actor_role,
  };
  for (const field of ['old_data', 'new_data', 'metadata']) {
    if (Object.prototype.hasOwnProperty.call(row, field)) cleanedRow[field] = sanitizeAuditData(row[field]);
  }
  return cleanedRow;
};

const listAuditLogs = async (req, res) => {
  try {
    const dateError = validateDateRange(req.query);
    if (dateError) return res.status(400).json({ success: false, message: dateError });
    const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
    const preview = ['1', 'true'].includes(String(req.query.preview || '').toLowerCase());
    const allowedPageSizes = preview ? [5, 10, 25, 50, 100] : [10, 25, 50, 100];
    const pageSize = allowedPageSizes.includes(Number(req.query.pageSize || req.query.limit))
      ? Number(req.query.pageSize || req.query.limit) : 10;
    const direction = ['asc', 'oldest'].includes(String(req.query.sort || req.query.order).toLowerCase()) ? 'ASC' : 'DESC';
    const selectRows = preview ? activityPreviewSelect : rowSelect;
    const { where, params } = buildFilters(req.query);
    if (preview) {
      const [rows] = await pool.query(
        `${selectRows} WHERE ${where} ORDER BY al.created_at ${direction}, al.audit_id ${direction} LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return res.json({ success: true, data: rows.map(cleanRow), page, pageSize });
    }

    const [[countRows], [rows], [summaryRows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total ${auditJoins} WHERE ${where}`, params),
      pool.query(`${rowSelect} WHERE ${where} ORDER BY al.created_at ${direction}, al.audit_id ${direction} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]),
      pool.query(`SELECT
        SUM(CASE WHEN COALESCE(al.result, CASE WHEN al.status = 'FAILED' OR UPPER(al.action) = 'LOGIN_FAILED' THEN 'failure' ELSE 'success' END) = 'success' THEN 1 ELSE 0 END) AS success,
        SUM(CASE WHEN COALESCE(al.result, CASE WHEN al.status = 'FAILED' OR UPPER(al.action) = 'LOGIN_FAILED' THEN 'failure' ELSE 'success' END) = 'failure' THEN 1 ELSE 0 END) AS failure
        FROM audit_logs al WHERE ${where}`, params),
    ]);
    const total = Number(countRows[0]?.total || 0);
    const safePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    if (safePage !== page && total) {
      const [lastRows] = await pool.query(`${rowSelect} WHERE ${where} ORDER BY al.created_at ${direction}, al.audit_id ${direction} LIMIT ? OFFSET ?`, [...params, pageSize, (safePage - 1) * pageSize]);
      return res.json({
        success: true,
        data: lastRows.map(cleanRow),
        total,
        page: safePage,
        pageSize,
        counts: { success: Number(summaryRows[0]?.success || 0), failure: Number(summaryRows[0]?.failure || 0) },
      });
    }
    return res.json({
      success: true,
      data: rows.map(cleanRow),
      total,
      page,
      pageSize,
      counts: { success: Number(summaryRows[0]?.success || 0), failure: Number(summaryRows[0]?.failure || 0) },
    });
  } catch (error) {
    logger.error('listAuditLogs error', error);
    return res.status(500).json({ success: false, message: 'Unable to load audit logs.' });
  }
};

const getAuditLog = async (req, res) => {
  try {
    const dateError = validateDateRange(req.query);
    if (dateError) return res.status(400).json({ success: false, message: dateError });
    if (!/^\d+$/.test(String(req.params.id))) return res.status(400).json({ success: false, message: 'Invalid event ID.' });
    const [rows] = await pool.query(`${rowSelect} WHERE al.audit_id = ? LIMIT 1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Audit event not found.' });
    const event = cleanRow(rows[0]);
    const direction = ['asc', 'oldest'].includes(String(req.query.sort || '').toLowerCase()) ? 'ASC' : 'DESC';
    const { where, params } = buildFilters(req.query);
    const prevOperator = direction === 'DESC' ? '>' : '<';
    const nextOperator = direction === 'DESC' ? '<' : '>';
    const [[previousRows], [nextRows]] = await Promise.all([
      pool.query(`SELECT al.audit_id ${auditJoins} WHERE ${where} AND (al.created_at ${prevOperator} (SELECT created_at FROM audit_logs WHERE audit_id = ?) OR (al.created_at = (SELECT created_at FROM audit_logs WHERE audit_id = ?) AND al.audit_id ${prevOperator} ?)) ORDER BY al.created_at ${direction}, al.audit_id ${direction} LIMIT 1`, [...params, req.params.id, req.params.id, req.params.id]),
      pool.query(`SELECT al.audit_id ${auditJoins} WHERE ${where} AND (al.created_at ${nextOperator} (SELECT created_at FROM audit_logs WHERE audit_id = ?) OR (al.created_at = (SELECT created_at FROM audit_logs WHERE audit_id = ?) AND al.audit_id ${nextOperator} ?)) ORDER BY al.created_at ${direction === 'DESC' ? 'ASC' : 'DESC'}, al.audit_id ${direction === 'DESC' ? 'ASC' : 'DESC'} LIMIT 1`, [...params, req.params.id, req.params.id, req.params.id]),
    ]);
    return res.json({
      success: true,
      data: event,
      previousId: previousRows[0]?.audit_id || null,
      nextId: nextRows[0]?.audit_id || null,
    });
  } catch (error) {
    logger.error('getAuditLog error', error);
    return res.status(500).json({ success: false, message: 'Unable to load this audit event.' });
  }
};

const getAuditOptions = async (req, res) => {
  try {
    const [actions] = await pool.query('SELECT DISTINCT action FROM audit_logs ORDER BY action LIMIT 200');
    const [modules] = await pool.query('SELECT DISTINCT module FROM audit_logs ORDER BY module LIMIT 100');
    const search = String(req.query.q || '').trim().slice(0, 80);
    const [actors] = await pool.query(
      `SELECT DISTINCT u.user_id, u.full_name, u.username, u.role
       FROM audit_logs al JOIN users u ON u.user_id = COALESCE(al.actor_id, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED' THEN NULL ELSE al.user_id END)
       WHERE (? = '' OR u.full_name LIKE ? OR u.username LIKE ?)
       ORDER BY u.full_name LIMIT 100`,
      [search, `%${search}%`, `%${search}%`]
    );
    return res.json({
      success: true,
      data: {
        actions: actions.map((row) => row.action),
        modules: modules.map((row) => row.module),
        actors: actors.map((row) => ({ ...row, role: row.role === 'barangay_official' ? 'official' : row.role })),
        categories: Object.keys(CATEGORY_MODULES),
      },
    });
  } catch (error) {
    logger.error('getAuditOptions error', error);
    return res.status(500).json({ success: false, message: 'Unable to load audit filter options.' });
  }
};

const getAuditSummary = async (req, res) => {
  try {
    const dateError = validateDateRange(req.query);
    if (dateError) return res.status(400).json({ success: false, message: dateError });
    const { where, params } = buildFilters(req.query);
    const [[counts]] = await pool.query(`SELECT
      SUM(CASE WHEN DATE(al.created_at) = DATE(NOW()) THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN UPPER(al.action) = 'LOGIN_FAILED' AND al.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS failed_24h,
      COUNT(DISTINCT CASE WHEN UPPER(al.action) = 'LOGIN' AND al.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND COALESCE(al.actor_id, al.user_id) IS NOT NULL
        THEN COALESCE(al.actor_id, al.user_id) END) AS active_users_24h,
      SUM(CASE WHEN al.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND (
        al.module IN ('users', 'account-settings', 'admin-settings') OR al.action IN ('user_created','user_updated','role_changed','password_reset','USER_CREATED')
      ) THEN 1 ELSE 0 END) AS admin_actions_7d
      ${auditJoins} WHERE ${where}`, params);

    const [repeatedAccounts] = await pool.query(`SELECT
      COALESCE(al.target_label, target.username, 'an account') AS account, COUNT(*) AS attempts
      FROM audit_logs al LEFT JOIN users actor ON actor.user_id = COALESCE(al.actor_id, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED' THEN NULL ELSE al.user_id END)
      LEFT JOIN users target ON target.user_id = CASE
        WHEN (UPPER(al.action) = 'LOGIN_FAILED' OR al.module = 'users' OR LOWER(COALESCE(al.target_type, al.table_name, '')) IN ('user', 'users'))
          AND ${isUnsignedIntegerSql('COALESCE(al.target_id, CAST(al.user_id AS CHAR))')}
        THEN CAST(COALESCE(al.target_id, CAST(al.user_id AS CHAR)) AS UNSIGNED) ELSE NULL END
      WHERE UPPER(al.action) = 'LOGIN_FAILED' AND al.created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
        AND (${where})
      GROUP BY COALESCE(al.target_id, CAST(al.user_id AS CHAR)), al.target_label, target.username
      HAVING COUNT(*) >= 3 ORDER BY attempts DESC LIMIT 10`, params);
    const [repeatedIps] = await pool.query(`SELECT al.ip_address, COUNT(*) AS attempts
      FROM audit_logs al LEFT JOIN users actor ON actor.user_id = COALESCE(al.actor_id, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED' THEN NULL ELSE al.user_id END)
      LEFT JOIN users target ON target.user_id = CASE
        WHEN (UPPER(al.action) = 'LOGIN_FAILED' OR al.module = 'users' OR LOWER(COALESCE(al.target_type, al.table_name, '')) IN ('user', 'users'))
          AND ${isUnsignedIntegerSql('COALESCE(al.target_id, CAST(al.user_id AS CHAR))')}
        THEN CAST(COALESCE(al.target_id, CAST(al.user_id AS CHAR)) AS UNSIGNED) ELSE NULL END
      WHERE UPPER(al.action) = 'LOGIN_FAILED' AND al.ip_address IS NOT NULL
        AND al.created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE) AND (${where})
      GROUP BY al.ip_address HAVING COUNT(*) >= 3 ORDER BY attempts DESC LIMIT 10`, params);
    const [sensitiveEvents] = await pool.query(`SELECT al.audit_id, al.action, al.target_label, target.full_name AS target_name,
      al.created_at       FROM audit_logs al LEFT JOIN users actor ON actor.user_id = COALESCE(al.actor_id, CASE WHEN UPPER(al.action) = 'LOGIN_FAILED' THEN NULL ELSE al.user_id END)
      LEFT JOIN users target ON target.user_id = CASE
        WHEN (al.module = 'users' OR LOWER(COALESCE(al.target_type, al.table_name, '')) IN ('user', 'users'))
          AND ${isUnsignedIntegerSql('COALESCE(al.target_id, CAST(al.record_id AS CHAR))')}
        THEN CAST(COALESCE(al.target_id, CAST(al.record_id AS CHAR)) AS UNSIGNED) ELSE NULL END
      WHERE al.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND UPPER(al.action) IN ('PASSWORD_RESET','ROLE_CHANGED','ACCOUNT_LOCKED')
        AND (${where}) ORDER BY al.created_at DESC LIMIT 10`, params);
    const [unusual] = await pool.query(`SELECT al.audit_id, al.action, al.created_at, al.ip_address,
      COALESCE(actor.username, 'Unknown account') AS actor_username
      FROM audit_logs al LEFT JOIN users actor ON actor.user_id = COALESCE(al.actor_id, al.user_id)
      LEFT JOIN users target ON target.user_id = CASE
        WHEN (al.module = 'users' OR LOWER(COALESCE(al.target_type, al.table_name, '')) IN ('user', 'users'))
          AND ${isUnsignedIntegerSql('COALESCE(al.target_id, CAST(al.record_id AS CHAR))')}
        THEN CAST(COALESCE(al.target_id, CAST(al.record_id AS CHAR)) AS UNSIGNED) ELSE NULL END
      WHERE UPPER(al.action) = 'LOGIN'
        AND ${unusualHourPredicate}
        AND (${where}) ORDER BY al.created_at DESC LIMIT 10`, params);
    const attention = [
      ...repeatedAccounts.map((row) => ({ type: 'repeated-failures', eventId: null, message: `${row.attempts} failed sign-ins for ${row.account} in 15 minutes.`, filter: { action: 'LOGIN_FAILED', result: 'failure' } })),
      ...repeatedIps.map((row) => ({ type: 'repeated-failures', eventId: null, message: `${row.attempts} failed sign-ins from ${row.ip_address} in 15 minutes.`, filter: { action: 'LOGIN_FAILED', result: 'failure' } })),
      ...sensitiveEvents.map((row) => ({ type: String(row.action).toLowerCase(), eventId: row.audit_id, message: `${String(row.action).replace(/_/g, ' ')}${row.target_name || row.target_label ? ` for ${row.target_name || row.target_label}` : ''} in the last 24 hours.`, filter: { action: row.action } })),
      ...unusual.map((row) => ({ type: 'unusual-hour', eventId: row.audit_id, message: `Sign-in activity by @${row.actor_username} was recorded during overnight hours.`, filter: { action: row.action } })),
    ];
    return res.json({
      success: true,
      data: {
        counts: Object.fromEntries(Object.entries(counts || {}).map(([key, value]) => [key, Number(value || 0)])),
        attention,
      },
    });
  } catch (error) {
    logger.error('getAuditSummary error', error);
    return res.status(500).json({ success: false, message: 'Unable to load audit insights.' });
  }
};

const csvCell = (value) => {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

const formatManilaTimestamp = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date);
  return `${parts.replace(' ', 'T')}+08:00`;
};

const deviceLabel = (userAgent) => {
  const value = String(userAgent || '');
  if (!value) return '';
  const browser = /Edg\/[\d.]+/.test(value) ? 'Edge'
    : /Chrome\/[\d.]+/.test(value) ? 'Chrome'
      : /Firefox\/[\d.]+/.test(value) ? 'Firefox'
        : /Safari\/[\d.]+/.test(value) ? 'Safari' : 'Browser';
  const platform = /Windows/.test(value) ? 'Windows'
    : /Mac OS|Macintosh/.test(value) ? 'macOS'
      : /Android/.test(value) ? 'Android'
        : /iPhone|iPad/.test(value) ? 'iOS'
          : /Linux/.test(value) ? 'Linux' : 'device';
  return `${browser} on ${platform}`;
};

const exportAuditLogs = async (req, res) => {
  let connection;
  let stream;
  let released = false;
  const releaseConnection = () => {
    if (connection && !released) {
      released = true;
      connection.release();
    }
  };
  try {
    const dateError = validateDateRange(req.query);
    if (dateError) return res.status(400).json({ success: false, message: dateError });
    const { where, params } = buildFilters(req.query);
    await logAudit({
      actorId: req.user.user_id,
      action: 'audit_exported',
      module: 'audit',
      description: 'Exported filtered audit events.',
      result: 'success',
      severity: 'info',
      metadata: {
        filters: {
          from: req.query.from || null,
          to: req.query.to || null,
          modules: toList(req.query.modules || req.query.module).slice(0, 100),
          actions: toList(req.query.actions || req.query.action).slice(0, 100),
          actor_id: /^\d+$/.test(String(req.query.userId || '')) ? String(req.query.userId) : null,
          target_user_id: /^\d+$/.test(String(req.query.target_user_id || '')) ? String(req.query.target_user_id) : null,
          result: ['success', 'failure'].includes(String(req.query.result || '').toLowerCase()) ? req.query.result : null,
          severity: ['info', 'warning', 'critical'].includes(String(req.query.severity || '').toLowerCase()) ? req.query.severity : null,
          search_used: Boolean(req.query.q || req.query.search),
          sort: ['oldest', 'asc'].includes(String(req.query.sort || '').toLowerCase()) ? 'oldest' : 'newest',
        },
      },
      req,
    });
    connection = await pool.getConnection();
    const direction = ['oldest', 'asc'].includes(String(req.query.sort || '').toLowerCase()) ? 'ASC' : 'DESC';
    const query = connection.connection.query(
      `${rowSelect} WHERE ${where} ORDER BY al.created_at ${direction}, al.audit_id ${direction}`,
      params
    );
    stream = query.stream({ highWaterMark: 20 });
    const dateStamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="HealthSync_AuditLog_${dateStamp}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.write('\uFEFF');
    res.write(['Timestamp (ISO +08:00)', 'Readable local time', 'User', 'Username', 'Role', 'Event', 'Action key', 'Module', 'Description', 'Target', 'Result', 'IP address', 'Device', 'Event ID'].map(csvCell).join(',') + '\r\n');
    stream.on('data', (row) => {
      const event = cleanRow(row);
      const localIso = formatManilaTimestamp(row.created_at);
      const localReadable = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.created_at));
      const safeMetadata = sanitizeAuditData(row.metadata);
      const metadataDevice = typeof safeMetadata?.device === 'string' ? safeMetadata.device.trim().slice(0, 80) : '';
      const device = metadataDevice || deviceLabel(row.user_agent);
      const eventLabel = event.description || String(event.action || 'Unknown event').replace(/[_-]+/g, ' ');
      res.write([
        localIso, localReadable, event.actor_name || 'System', event.actor_username || '',
        event.actor_role || '', eventLabel, event.action, event.module, event.description,
        event.target_label || event.target_user_name || '', event.result, event.ip_address, device, event.audit_id,
      ].map(csvCell).join(',') + '\r\n');
    });
    stream.on('error', (error) => {
      logger.error('exportAuditLogs stream error', error);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Unable to export audit logs.' });
      else res.destroy();
      releaseConnection();
    });
    stream.on('end', () => {
      res.end();
      releaseConnection();
    });
    res.on('close', () => {
      if (!res.writableEnded) stream.destroy();
      releaseConnection();
    });
  } catch (error) {
    releaseConnection();
    logger.error('exportAuditLogs error', error);
    if (!res.headersSent) return res.status(500).json({ success: false, message: 'Unable to export audit logs.' });
    return res.destroy(error);
  }
};

module.exports = {
  listAuditLogs,
  getAuditLog,
  getAuditStats: getAuditSummary,
  getAuditOptions,
  getAuditSummary,
  exportAuditLogs,
  buildFilters,
  dateToManilaSql,
  validateDateRange,
  cleanRow,
  activityPreviewSelect,
  csvCell,
  formatManilaTimestamp,
};
