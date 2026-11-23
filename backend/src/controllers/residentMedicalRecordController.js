const pool = require('../config/database');
const { writeAudit } = require('../services/auditService');
const logger = require('../services/logger');
const { validateClinicalRecord } = require('../services/clinicalRecordValidation');
const { validateMaternalRecord } = require('../services/maternalRecordValidation');

const RECORD_TABLES = {
  clinical: 'patient_clinical_records',
  child: 'child_records',
  maternal: 'maternal_records',
  immunization: 'immunization_records'
};

const parseIds = (req) => {
  const residentId = Number(req.params.residentId);
  const recordId = req.params.recordId === undefined ? null : Number(req.params.recordId);
  return Number.isSafeInteger(residentId) && residentId > 0 &&
    (recordId === null || (Number.isSafeInteger(recordId) && recordId > 0))
    ? { residentId, recordId }
    : null;
};

const tableFor = (recordType) => RECORD_TABLES[recordType] || null;
const normalizeDateColumn = (value) => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
};
const mergeMaternalEdc = (recordData, edc) => {
  const data = typeof recordData === 'string' ? JSON.parse(recordData) : recordData;
  if (data && typeof data === 'object' && !Array.isArray(data) && !data.edc && edc) {
    data.edc = normalizeDateColumn(edc);
  }
  return data;
};

const validateRecordData = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    return JSON.stringify(value).length <= 1_000_000;
  } catch (error) {
    return false;
  }
};

const listAllResidentMedicalRecords = async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const requestedLimit = Number.parseInt(req.query.limit, 10) || 100;
  const limit = Math.min(Math.max(1, requestedLimit), 100);
  const offset = (page - 1) * limit;
  const unions = Object.entries(RECORD_TABLES).map(([recordType, table]) => (
    `SELECT mr.id, mr.resident_id, mr.record_data, ${recordType === 'maternal' ? 'mr.edc' : 'NULL'} AS edc,
      mr.recorded_by, mr.created_at, mr.updated_at,
      u.full_name AS recorded_by_name, '${recordType}' AS record_type
     FROM \`${table}\` mr
     LEFT JOIN users u ON u.user_id = mr.recorded_by`
  ));
  const unionSql = unions.join(' UNION ALL ');
  try {
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM (${unionSql}) all_records`);
    const total = Number(countRows[0]?.total || 0);
    const [rows] = await pool.query(
      `SELECT * FROM (${unionSql}) all_records
       ORDER BY resident_id ASC, record_type ASC, updated_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const items = rows.map((row) => ({
      ...row,
      record_data: row.record_type === 'maternal'
        ? mergeMaternalEdc(row.record_data, row.edc)
        : typeof row.record_data === 'string' ? JSON.parse(row.record_data) : row.record_data,
    }));
    return res.json({
      success: true,
      data: {
        items,
        total,
        page,
        limit,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    logger.error('listAllResidentMedicalRecords error', error);
    return res.status(500).json({ success: false, message: 'Unable to download medical records.' });
  }
};

const listResidentMedicalRecords = async (req, res) => {
  const ids = parseIds(req);
  const table = tableFor(req.params.recordType);
  if (!ids || !table) return res.status(400).json({ success: false, message: 'Invalid resident or record type.' });
  try {
    const [residentRows] = await pool.query('SELECT resident_id FROM residents WHERE resident_id = ?', [ids.residentId]);
    if (!residentRows.length) return res.status(404).json({ success: false, message: 'Resident not found.' });
    const [rows] = await pool.query(
      `SELECT mr.id, mr.resident_id, mr.record_data, ${req.params.recordType === 'maternal' ? 'mr.edc' : 'NULL'} AS edc,
        mr.recorded_by, mr.created_at, mr.updated_at,
        u.full_name AS recorded_by_name
       FROM \`${table}\` mr
       LEFT JOIN users u ON u.user_id = mr.recorded_by
       WHERE mr.resident_id = ? ORDER BY mr.updated_at DESC, mr.id DESC`,
      [ids.residentId]
    );
    return res.json({ success: true, data: rows.map((row) => ({
      ...row,
      record_data: req.params.recordType === 'maternal'
        ? mergeMaternalEdc(row.record_data, row.edc)
        : typeof row.record_data === 'string' ? JSON.parse(row.record_data) : row.record_data,
    })) });
  } catch (error) {
    logger.error('listResidentMedicalRecords error', error);
    return res.status(500).json({ success: false, message: 'Unable to load medical records.' });
  }
};

const getResidentMedicalRecord = async (req, res) => {
  const ids = parseIds(req);
  const table = tableFor(req.params.recordType);
  if (!ids || ids.recordId === null || !table) {
    return res.status(400).json({ success: false, message: 'Invalid resident, record, or record type.' });
  }
  try {
    const [rows] = await pool.query(
      `SELECT mr.id, mr.resident_id, mr.record_data, ${req.params.recordType === 'maternal' ? 'mr.edc' : 'NULL'} AS edc,
        mr.created_at, mr.updated_at,
        r.first_name, r.middle_name, r.last_name, r.suffix, r.birthdate, r.sex
       FROM \`${table}\` mr
       JOIN residents r ON r.resident_id = mr.resident_id
       WHERE mr.id = ? AND mr.resident_id = ?`,
      [ids.recordId, ids.residentId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Medical record not found.' });
    const record = rows[0];
    return res.json({
      success: true,
      data: {
        ...record,
        record_data: req.params.recordType === 'maternal'
          ? mergeMaternalEdc(record.record_data, record.edc)
          : typeof record.record_data === 'string' ? JSON.parse(record.record_data) : record.record_data
      }
    });
  } catch (error) {
    logger.error('getResidentMedicalRecord error', error);
    return res.status(500).json({ success: false, message: 'Unable to load medical record.' });
  }
};

const createResidentMedicalRecord = async (req, res) => {
  const ids = parseIds(req);
  const table = tableFor(req.params.recordType);
  if (!ids || !table) return res.status(400).json({ success: false, message: 'Invalid resident or record type.' });
  if (!validateRecordData(req.body?.record_data)) return res.status(400).json({ success: false, message: 'A valid record is required.' });
  if (req.params.recordType === 'clinical') {
    const errors = validateClinicalRecord(req.body.record_data);
    if (Object.keys(errors).length) return res.status(400).json({ success: false, message: Object.values(errors)[0], errors });
  }
  if (req.params.recordType === 'maternal') {
    const errors = validateMaternalRecord(req.body.record_data);
    if (Object.keys(errors).length) return res.status(400).json({ success: false, message: Object.values(errors)[0], errors });
  }
  try {
    const connection = req.idempotencyConnection || pool;
    const [residentRows] = await connection.query('SELECT resident_id FROM residents WHERE resident_id = ?', [ids.residentId]);
    if (!residentRows.length) return res.status(404).json({ success: false, message: 'Resident not found.' });
    const maternal = req.params.recordType === 'maternal';
    const [result] = await connection.query(
      maternal
        ? `INSERT INTO \`${table}\` (resident_id, record_data, edc, recorded_by) VALUES (?, ?, ?, ?)`
        : `INSERT INTO \`${table}\` (resident_id, record_data, recorded_by) VALUES (?, ?, ?)`,
      maternal
        ? [ids.residentId, JSON.stringify(req.body.record_data), normalizeDateColumn(req.body.record_data.edc), req.user.user_id]
        : [ids.residentId, JSON.stringify(req.body.record_data), req.user.user_id]
    );
    const [rows] = await connection.query(
      `SELECT id, resident_id, record_data, ${maternal ? 'edc' : 'NULL'} AS edc, created_at, updated_at FROM \`${table}\` WHERE id = ?`,
      [result.insertId]
    );
    if (maternal) rows[0].record_data = mergeMaternalEdc(rows[0].record_data, rows[0].edc);
    await writeAudit({
      user_id: req.user.user_id,
      action: 'CREATE',
      module: req.params.recordType,
      table_name: table,
      record_id: result.insertId,
      new_data: req.body.record_data,
      connection: req.idempotencyConnection,
    });
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    logger.error('createResidentMedicalRecord error', error);
    return res.status(500).json({ success: false, message: 'Unable to save medical record.' });
  }
};

const updateResidentMedicalRecord = async (req, res) => {
  const ids = parseIds(req);
  const table = tableFor(req.params.recordType);
  if (!ids || !table) return res.status(400).json({ success: false, message: 'Invalid resident, record, or record type.' });
  if (!validateRecordData(req.body?.record_data)) return res.status(400).json({ success: false, message: 'A valid record is required.' });
  if (req.params.recordType === 'clinical') {
    const errors = validateClinicalRecord(req.body.record_data);
    if (Object.keys(errors).length) return res.status(400).json({ success: false, message: Object.values(errors)[0], errors });
  }
  if (req.params.recordType === 'maternal') {
    const errors = validateMaternalRecord(req.body.record_data);
    if (Object.keys(errors).length) return res.status(400).json({ success: false, message: Object.values(errors)[0], errors });
  }
  try {
    const [oldRows] = await pool.query(`SELECT * FROM \`${table}\` WHERE id = ? AND resident_id = ?`, [ids.recordId, ids.residentId]);
    if (!oldRows.length) return res.status(404).json({ success: false, message: 'Medical record not found.' });
    const maternal = req.params.recordType === 'maternal';
    await pool.query(
      `UPDATE \`${table}\` SET record_data = ?${maternal ? ', edc = ?' : ''} WHERE id = ? AND resident_id = ?`,
      maternal
        ? [JSON.stringify(req.body.record_data), normalizeDateColumn(req.body.record_data.edc), ids.recordId, ids.residentId]
        : [JSON.stringify(req.body.record_data), ids.recordId, ids.residentId]
    );
    const [rows] = await pool.query(
      `SELECT id, resident_id, record_data, ${maternal ? 'edc' : 'NULL'} AS edc, created_at, updated_at FROM \`${table}\` WHERE id = ?`,
      [ids.recordId]
    );
    if (maternal) rows[0].record_data = mergeMaternalEdc(rows[0].record_data, rows[0].edc);
    await writeAudit({ user_id: req.user.user_id, action: 'UPDATE', module: req.params.recordType, table_name: table, record_id: ids.recordId, old_data: oldRows[0].record_data, new_data: req.body.record_data });
    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    logger.error('updateResidentMedicalRecord error', error);
    return res.status(500).json({ success: false, message: 'Unable to update medical record.' });
  }
};

const deleteResidentMedicalRecord = async (req, res) => {
  const ids = parseIds(req);
  const table = tableFor(req.params.recordType);
  if (!ids || !table) return res.status(400).json({ success: false, message: 'Invalid resident, record, or record type.' });
  try {
    const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE id = ? AND resident_id = ?`, [ids.recordId, ids.residentId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Medical record not found.' });
    await pool.query(`DELETE FROM \`${table}\` WHERE id = ? AND resident_id = ?`, [ids.recordId, ids.residentId]);
    await writeAudit({ user_id: req.user.user_id, action: 'DELETE', module: req.params.recordType, table_name: table, record_id: ids.recordId, old_data: rows[0].record_data });
    return res.json({ success: true, message: 'Medical record deleted.' });
  } catch (error) {
    logger.error('deleteResidentMedicalRecord error', error);
    return res.status(500).json({ success: false, message: 'Unable to delete medical record.' });
  }
};

module.exports = {
  listAllResidentMedicalRecords,
  listResidentMedicalRecords,
  getResidentMedicalRecord,
  createResidentMedicalRecord,
  updateResidentMedicalRecord,
  deleteResidentMedicalRecord,
};
