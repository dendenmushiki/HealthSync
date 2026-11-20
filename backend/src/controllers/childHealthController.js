const pool = require('../config/database');
const { writeAudit } = require('../services/auditService');
const logger = require('../services/logger');

const CHILD_HEALTH_FIELDS = [
  'resident_id',
  'family_serial_number',
  'nhts_number',
  'philhealth_number',
  'philhealth_category',
  'religion',
  'birthplace',
  'birth_weight_kg',
  'school_name',
  'grade_level',
  'parent_guardian_name',
  'parent_guardian_relationship',
  'record_date',
  'history_of_present_illness',
  'past_medical_history',
  'hospitalization_history',
  'medication_allergies',
  'food_allergies',
  'family_medical_history',
  'birth_history',
  'immunization_history',
  'blood_pressure',
  'heart_rate',
  'respiratory_rate',
  'temperature',
  'weight_kg',
  'height_cm',
  'findings',
  'assessment',
  'plan',
  'remarks'
];

const normalizeChildPayload = (body) => {
  const payload = {};
  for (const field of CHILD_HEALTH_FIELDS) {
    if (body[field] !== undefined) payload[field] = body[field];
  }

  if (!payload.record_date && body.date_time) {
    payload.record_date = String(body.date_time).slice(0, 10);
  }

  if (payload.temperature !== undefined && payload.temperature !== null && payload.temperature !== '' && Number.isNaN(Number(payload.temperature))) {
    throw new Error('Temperature must be numeric');
  }

  if (payload.weight_kg !== undefined && payload.weight_kg !== null && payload.weight_kg !== '' && Number.isNaN(Number(payload.weight_kg))) {
    throw new Error('Weight must be numeric');
  }

  if (payload.height_cm !== undefined && payload.height_cm !== null && payload.height_cm !== '' && Number.isNaN(Number(payload.height_cm))) {
    throw new Error('Height must be numeric');
  }

  return payload;
};

const listChildHealthRecords = async (req, res) => {
  try {
    const { resident_id, page = 1, limit = 25, startDate, endDate } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let where = 'WHERE 1=1';
    const params = [];

    if (resident_id) {
      where += ' AND chr.resident_id = ?';
      params.push(Number(resident_id));
    }

    if (startDate) {
      where += ' AND chr.record_date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      where += ' AND chr.record_date <= ?';
      params.push(endDate);
    }

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM child_health_records chr ${where}`, params);
    const total = Number(countRows[0]?.total || 0);

    const sql = `
      SELECT 
        chr.*,
        r.first_name,
        r.last_name,
        r.birthdate,
        r.sex,
        u.full_name AS recorded_by_name
      FROM child_health_records chr
      LEFT JOIN residents r ON r.resident_id = chr.resident_id
      LEFT JOIN users u ON u.user_id = chr.recorded_by
      ${where}
      ORDER BY chr.record_date DESC, chr.id DESC
      LIMIT ? OFFSET ?
    `;

    params.push(Number(limit), Number(offset));
    const [rows] = await pool.query(sql, params);

    return res.json({ success: true, data: { items: rows, total, page: Number(page), limit: Number(limit) } });
  } catch (error) {
    logger.error('listChildHealthRecords error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getChildHealthRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const sql = `
      SELECT 
        chr.*,
        r.first_name,
        r.last_name,
        r.middle_name,
        r.birthdate,
        r.sex,
        r.household_no,
        u.full_name AS recorded_by_name
      FROM child_health_records chr
      LEFT JOIN residents r ON r.resident_id = chr.resident_id
      LEFT JOIN users u ON u.user_id = chr.recorded_by
      WHERE chr.id = ?
    `;

    const [rows] = await pool.query(sql, [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Child health record not found' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    logger.error('getChildHealthRecord error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const createChildHealthRecord = async (req, res) => {
  try {
    const connection = req.idempotencyConnection || pool;
    const userId = req.user.user_id;
    const payload = normalizeChildPayload(req.body);

    if (!payload.resident_id) {
      return res.status(400).json({ success: false, message: 'Resident ID is required' });
    }

    if (!payload.record_date) {
      return res.status(400).json({ success: false, message: 'Record date is required' });
    }

    const [residentCheck] = await connection.query('SELECT resident_id, birthdate FROM residents WHERE resident_id = ?', [payload.resident_id]);
    if (!residentCheck || residentCheck.length === 0) {
      return res.status(400).json({ success: false, message: 'Resident not found' });
    }

    const resident = residentCheck[0];
    const birth = resident.birthdate ? new Date(`${resident.birthdate}T00:00:00`) : null;
    if (!birth || Number.isNaN(birth.getTime()) || (new Date() - birth) / (1000 * 60 * 60 * 24 * 365.25) >= 18) {
      return res.status(400).json({ success: false, message: 'Child health records are only supported for child residents under 18 years old.' });
    }

    const insertFields = ['resident_id', 'record_date', 'recorded_by'];
    const insertValues = [payload.resident_id, payload.record_date, userId];

    for (const field of CHILD_HEALTH_FIELDS) {
      if (field === 'resident_id' || field === 'record_date' || field === 'recorded_by') continue;
      if (payload[field] !== undefined) {
        insertFields.push(field);
        insertValues.push(payload[field]);
      }
    }

    const insertSql = `INSERT INTO child_health_records (${insertFields.map((field) => `\`${field}\``).join(', ')}) VALUES (${insertFields.map(() => '?').join(', ')})`;
    const [result] = await connection.query(insertSql, insertValues);

    await writeAudit({
      user_id: userId,
      action: 'CREATE',
      module: 'child_health_records',
      table_name: 'child_health_records',
      record_id: result.insertId,
      new_data: { ...payload, recorded_by: userId },
      connection: req.idempotencyConnection,
    });

    const [rows] = await connection.query('SELECT * FROM child_health_records WHERE id = ?', [result.insertId]);
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    logger.error('createChildHealthRecord error', error);
    const message = error.message || 'Server error';
    const status = message.includes('Temperature') || message.includes('Weight') || message.includes('Height') ? 400 : 500;
    return res.status(status).json({ success: false, message });
  }
};

const updateChildHealthRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.user_id;
    const [existingRows] = await pool.query('SELECT * FROM child_health_records WHERE id = ?', [id]);

    if (!existingRows || existingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Child health record not found' });
    }

    const oldData = existingRows[0];
    const payload = normalizeChildPayload({ ...oldData, ...req.body });

    const updateFields = [];
    const updateValues = [];

    for (const field of CHILD_HEALTH_FIELDS) {
      if (field === 'resident_id' || field === 'recorded_by') continue;
      if (req.body[field] !== undefined) {
        updateFields.push(`\`${field}\` = ?`);
        updateValues.push(payload[field]);
      }
    }

    if (req.body.record_date !== undefined && !req.body.record_date) {
      return res.status(400).json({ success: false, message: 'Record date is required' });
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    updateValues.push(id);
    await pool.query(`UPDATE child_health_records SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);

    const [rows] = await pool.query('SELECT * FROM child_health_records WHERE id = ?', [id]);
    await writeAudit({
      user_id: userId,
      action: 'UPDATE',
      module: 'child_health_records',
      table_name: 'child_health_records',
      record_id: id,
      old_data: oldData,
      new_data: rows[0]
    });

    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    logger.error('updateChildHealthRecord error', error);
    const message = error.message || 'Server error';
    const status = message.includes('Temperature') || message.includes('Weight') || message.includes('Height') ? 400 : 500;
    return res.status(status).json({ success: false, message });
  }
};

const deleteChildHealthRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.user_id;
    const [rows] = await pool.query('SELECT * FROM child_health_records WHERE id = ?', [id]);

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Child health record not found' });
    }

    const oldData = rows[0];
    await pool.query('DELETE FROM child_health_records WHERE id = ?', [id]);

    await writeAudit({
      user_id: userId,
      action: 'DELETE',
      module: 'child_health_records',
      table_name: 'child_health_records',
      record_id: id,
      old_data: oldData
    });

    return res.json({ success: true, message: 'Child health record deleted' });
  } catch (error) {
    logger.error('deleteChildHealthRecord error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  listChildHealthRecords,
  getChildHealthRecord,
  createChildHealthRecord,
  updateChildHealthRecord,
  deleteChildHealthRecord
};
