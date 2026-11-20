/**
 * Adolescent BMI Controller
 * Handles BMI recording for adolescents 5-19 years (60-228 months)
 * Uses WHO 2007 BMI-for-age reference for classification
 */

const pool = require('../config/database');
const { writeAudit } = require('../services/auditService');
const { calculateAssessment } = require('../services/nutrition/adolescentBmiAssessment');
const logger = require('../services/logger');

/**
 * List adolescent BMI records
 */
const listAdolescentBMI = async (req, res) => {
  try {
    const { page = 1, limit = 25, resident_id, startDate, endDate } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const orderBy = req.query.sort === 'created_at'
      ? 'abr.created_at DESC, abr.record_id DESC'
      : 'abr.record_date DESC, abr.record_id DESC';

    let where = 'WHERE 1=1';
    const params = [];

    if (resident_id) {
      where += ' AND abr.resident_id = ?';
      params.push(Number(resident_id));
    }

    if (startDate) {
      where += ' AND abr.record_date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      where += ' AND abr.record_date <= ?';
      params.push(endDate);
    }

    // Get total
    const countSql = `SELECT COUNT(*) as total FROM adolescent_bmi_records abr ${where}`;
    const [countRows] = await pool.query(countSql, params);
    const total = countRows[0].total;

    // Get records
    const sql = `
      SELECT 
        abr.record_id,
        abr.resident_id,
        abr.record_date,
        abr.age_years,
        abr.age_months,
        abr.height_cm,
        abr.weight_kg,
        abr.bmi,
        abr.bmi_for_age_zscore,
        abr.bmi_for_age_category,
        abr.recorded_by,
        u.full_name as recorded_by_name,
        r.first_name,
        r.last_name,
        r.birthdate,
        r.sex,
        abr.created_at
      FROM adolescent_bmi_records abr
      LEFT JOIN users u ON abr.recorded_by = u.user_id
      LEFT JOIN residents r ON abr.resident_id = r.resident_id
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    params.push(Number(limit), Number(offset));
    const [rows] = await pool.query(sql, params);

    return res.json({
      success: true,
      data: {
        items: rows,
        total,
        page: Number(page),
        limit: Number(limit)
      }
    });
  } catch (err) {
    logger.error('listAdolescentBMI error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Get single adolescent BMI record
 */
const getAdolescentBMI = async (req, res) => {
  try {
    const { id } = req.params;

    const sql = `
      SELECT 
        abr.*,
        r.first_name,
        r.last_name,
        r.birthdate,
        r.sex,
        u.full_name as recorded_by_name
      FROM adolescent_bmi_records abr
      LEFT JOIN residents r ON abr.resident_id = r.resident_id
      LEFT JOIN users u ON abr.recorded_by = u.user_id
      WHERE abr.record_id = ?
    `;

    const [rows] = await pool.query(sql, [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Adolescent BMI record not found' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('getAdolescentBMI error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const previewAdolescentBMI = async (req, res) => {
  try {
    const { resident_id, height_cm, weight_kg, record_date } = req.body;
    if (!resident_id || !height_cm || !weight_kg || !record_date) {
      return res.status(400).json({ success: false, message: 'resident_id, height_cm, weight_kg, and record_date are required' });
    }

    const [residentRows] = await pool.query('SELECT birthdate, sex FROM residents WHERE resident_id = ?', [resident_id]);
    if (!residentRows.length) return res.status(404).json({ success: false, message: 'Resident not found' });
    const assessment = calculateAssessment(residentRows[0], record_date, weight_kg, height_cm);
    return res.json({ success: true, data: assessment });
  } catch (err) {
    logger.error('previewAdolescentBMI error', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Unable to calculate BMI preview', errors: err.errors });
  }
};

/**
 * Create adolescent BMI record with WHO BMI-for-age classification
 */
const createAdolescentBMI = async (req, res) => {
  try {
    const connection = req.idempotencyConnection || pool;
    const { resident_id, height_cm, weight_kg, record_date } = req.body;
    const userId = req.user.user_id;

    // Validate inputs
    if (!resident_id || !height_cm || !weight_kg || !record_date) {
      return res.status(400).json({
        success: false,
        message: 'resident_id, height_cm, weight_kg, and record_date are required'
      });
    }

    // Verify resident exists and get info
    const [residentCheck] = await connection.query(
      'SELECT resident_id, birthdate, sex FROM residents WHERE resident_id = ?',
      [resident_id]
    );

    if (!residentCheck || residentCheck.length === 0) {
      return res.status(400).json({ success: false, message: 'Resident not found' });
    }

    const resident = residentCheck[0];
    const assessment = calculateAssessment(resident, record_date, weight_kg, height_cm);

    // Insert record
    const sql = `
      INSERT INTO adolescent_bmi_records 
        (resident_id, record_date, age_years, age_months, height_cm, weight_kg, bmi, bmi_for_age_zscore, bmi_for_age_category, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await connection.query(sql, [
      resident_id,
      assessment.record_date,
      assessment.age_years,
      assessment.age_months,
      assessment.height_cm,
      assessment.weight_kg,
      assessment.bmi,
      assessment.bmi_for_age_zscore,
      assessment.bmi_for_age_category,
      userId
    ]);

    const newId = result.insertId;

    // Audit
    await writeAudit({
      user_id: userId,
      action: 'CREATE',
      module: 'adolescent_bmi',
      table_name: 'adolescent_bmi_records',
      record_id: newId,
      new_data: { resident_id, ...assessment },
      connection: req.idempotencyConnection,
    });

    // Get full record
    const [rows] = await connection.query(
      'SELECT * FROM adolescent_bmi_records WHERE record_id = ?',
      [newId]
    );

    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('createAdolescentBMI error', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Server error', errors: err.errors });
  }
};

/**
 * Update adolescent BMI record
 */
const updateAdolescentBMI = async (req, res) => {
  try {
    const { id } = req.params;
    const { resident_id, height_cm, weight_kg, record_date } = req.body;
    const userId = req.user.user_id;

    const [oldRecords] = await pool.query(
      'SELECT * FROM adolescent_bmi_records WHERE record_id = ?',
      [id]
    );

    if (!oldRecords || oldRecords.length === 0) {
      return res.status(404).json({ success: false, message: 'Adolescent BMI record not found' });
    }

    const oldData = oldRecords[0];

    const targetResidentId = resident_id !== undefined ? resident_id : oldData.resident_id;
    const targetRecordDate = record_date !== undefined ? record_date : oldData.record_date;
    const newHeight = height_cm !== undefined ? Number(height_cm) : Number(oldData.height_cm);
    const newWeight = weight_kg !== undefined ? Number(weight_kg) : Number(oldData.weight_kg);

    const updates = [];
    const values = [];

    if (resident_id !== undefined) {
      updates.push('resident_id = ?');
      values.push(Number(resident_id));
    }
    if (height_cm !== undefined) {
      updates.push('height_cm = ?');
      values.push(Number(height_cm));
    }
    if (weight_kg !== undefined) {
      updates.push('weight_kg = ?');
      values.push(Number(weight_kg));
    }
    if (record_date !== undefined) {
      updates.push('record_date = ?');
      values.push(record_date);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    const [residentCheck] = await pool.query(
      'SELECT resident_id, birthdate, sex FROM residents WHERE resident_id = ?',
      [targetResidentId]
    );

    if (!residentCheck || residentCheck.length === 0) {
      return res.status(400).json({ success: false, message: 'Resident not found' });
    }

    const assessment = calculateAssessment(residentCheck[0], targetRecordDate, newWeight, newHeight);

    updates.push('age_years = ?');
    values.push(assessment.age_years);
    updates.push('age_months = ?');
    values.push(assessment.age_months);
    updates.push('bmi = ?');
    values.push(assessment.bmi);

    updates.push('bmi_for_age_zscore = ?');
    values.push(assessment.bmi_for_age_zscore);
    updates.push('bmi_for_age_category = ?');
    values.push(assessment.bmi_for_age_category);

    values.push(id);

    const sql = `UPDATE adolescent_bmi_records SET ${updates.join(', ')} WHERE record_id = ?`;
    await pool.query(sql, values);

    const [rows] = await pool.query(
      'SELECT * FROM adolescent_bmi_records WHERE record_id = ?',
      [id]
    );

    await writeAudit({
      user_id: userId,
      action: 'UPDATE',
      module: 'adolescent_bmi',
      table_name: 'adolescent_bmi_records',
      record_id: id,
      old_data: oldData,
      new_data: rows[0]
    });

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('updateAdolescentBMI error', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Server error', errors: err.errors });
  }
};

const listPreviousAdolescentBMI = async (req, res) => {
  try {
    const residentId = Number(req.params.residentId);
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 50);
    if (!Number.isInteger(residentId) || residentId <= 0) {
      return res.status(400).json({ success: false, message: 'A valid resident ID is required.' });
    }
    const [rows] = await pool.query(`
      SELECT record_id, resident_id, record_date, age_years, age_months,
             height_cm, weight_kg, bmi, bmi_for_age_zscore, bmi_for_age_category,
             recorded_by, created_at
      FROM adolescent_bmi_records
      WHERE resident_id = ?
      ORDER BY record_date DESC, record_id DESC
      LIMIT ?
    `, [residentId, limit]);
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('listPreviousAdolescentBMI error', error);
    return res.status(500).json({ success: false, message: 'Unable to load previous adolescent BMI measurements.' });
  }
};

const deleteAdolescentBMI = async (req, res) => {
  try {
    const { id } = req.params;
    const [records] = await pool.query('SELECT * FROM adolescent_bmi_records WHERE record_id = ?', [id]);
    if (!records.length) return res.status(404).json({ success: false, message: 'Adolescent BMI record not found.' });

    await pool.query('DELETE FROM adolescent_bmi_records WHERE record_id = ?', [id]);
    await writeAudit({
      user_id: req.user.user_id,
      action: 'DELETE',
      module: 'adolescent_bmi',
      table_name: 'adolescent_bmi_records',
      record_id: id,
      old_data: records[0]
    });
    return res.json({ success: true, message: 'Adolescent BMI record deleted.' });
  } catch (error) {
    logger.error('deleteAdolescentBMI error', error);
    return res.status(500).json({ success: false, message: 'Unable to delete Adolescent BMI record.' });
  }
};

module.exports = {
  listAdolescentBMI,
  getAdolescentBMI,
  previewAdolescentBMI,
  createAdolescentBMI,
  updateAdolescentBMI,
  deleteAdolescentBMI,
  listPreviousAdolescentBMI
};
