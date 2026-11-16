/**
 * Adult BMI Controller
 * Handles BMI recording for adults 20+ years
 * Uses WHO standard BMI categories
 */

const pool = require('../config/database');
const { writeAudit } = require('../services/auditService');
const { ageService, bmiService } = require('../services/nutrition');
const logger = require('../services/logger');

/**
 * List adult BMI records
 */
const listAdultBMI = async (req, res) => {
  try {
    const { page = 1, limit = 25, resident_id, startDate, endDate } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const orderBy = req.query.sort === 'created_at'
      ? 'abr.created_at DESC, abr.bmi_id DESC'
      : 'abr.date_recorded DESC, abr.bmi_id DESC';

    let where = 'WHERE 1=1';
    const params = [];

    if (resident_id) {
      where += ' AND abr.resident_id = ?';
      params.push(Number(resident_id));
    }

    if (startDate) {
      where += ' AND abr.date_recorded >= ?';
      params.push(startDate);
    }

    if (endDate) {
      where += ' AND abr.date_recorded <= ?';
      params.push(endDate);
    }

    // Get total
    const countSql = `SELECT COUNT(*) as total FROM adult_bmi_records abr ${where}`;
    const [countRows] = await pool.query(countSql, params);
    const total = countRows[0].total;

    // Get records
    const sql = `
      SELECT 
        abr.bmi_id,
        abr.resident_id,
        abr.weight_kg,
        abr.height_cm,
        abr.bmi,
        abr.bmi_category,
        abr.date_recorded,
        abr.recorded_by,
        u.full_name as recorded_by_name,
        r.first_name,
        r.last_name,
        r.birthdate,
        abr.created_at
      FROM adult_bmi_records abr
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
    logger.error('listAdultBMI error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Get single adult BMI record
 */
const getAdultBMI = async (req, res) => {
  try {
    const { id } = req.params;

    const sql = `
      SELECT 
        abr.*,
        r.first_name,
        r.last_name,
        r.birthdate,
        u.full_name as recorded_by_name
      FROM adult_bmi_records abr
      LEFT JOIN residents r ON abr.resident_id = r.resident_id
      LEFT JOIN users u ON abr.recorded_by = u.user_id
      WHERE abr.bmi_id = ?
    `;

    const [rows] = await pool.query(sql, [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Adult BMI record not found' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('getAdultBMI error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Create adult BMI record with WHO classification
 */
const createAdultBMI = async (req, res) => {
  try {
    const { resident_id, height_cm, weight_kg, date_recorded } = req.body;
    const userId = req.user.user_id;

    // Validate inputs
    if (!resident_id || !height_cm || !weight_kg || !date_recorded) {
      return res.status(400).json({
        success: false,
        message: 'resident_id, height_cm, weight_kg, and date_recorded are required'
      });
    }

    // Validate BMI inputs
    const validation = bmiService.validateBMIInput(weight_kg, height_cm);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid BMI input',
        errors: validation.errors.reduce((mapped, message) => {
          const key = message.toLowerCase().includes('weight') ? 'weight_kg' : message.toLowerCase().includes('height') ? 'height_cm' : 'measurements';
          mapped[key] = message;
          return mapped;
        }, {})
      });
    }

    // Verify resident exists
    const [residentCheck] = await pool.query(
      'SELECT resident_id, birthdate FROM residents WHERE resident_id = ?',
      [resident_id]
    );

    if (!residentCheck || residentCheck.length === 0) {
      return res.status(400).json({ success: false, message: 'Resident not found' });
    }

    const resident = residentCheck[0];

    // Calculate age
    const ageYears = ageService.getAgeYears(resident.birthdate, new Date(date_recorded));

    // Verify age is 20+
    if (ageYears < 20) {
      return res.status(400).json({
        success: false,
        message: `Resident is ${ageYears} years old. Adult BMI is for ages 20+. Use Adolescent BMI for ages 5-19.`
      });
    }

    // Calculate BMI
    const bmi = bmiService.calculateBMI(weight_kg, height_cm);

    // Classify
    const category = bmiService.classifyAdultBMI(bmi);

    // Insert record
    const sql = `
      INSERT INTO adult_bmi_records 
        (resident_id, weight_kg, height_cm, bmi, bmi_category, date_recorded, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(sql, [
      resident_id,
      weight_kg,
      height_cm,
      bmi,
      category,
      date_recorded,
      userId
    ]);

    const newId = result.insertId;

    // Audit
    await writeAudit({
      user_id: userId,
      action: 'CREATE',
      module: 'adult_bmi',
      table_name: 'adult_bmi_records',
      record_id: newId,
      new_data: { resident_id, weight_kg, height_cm, bmi, bmi_category: category, date_recorded }
    });

    // Get full record
    const [rows] = await pool.query(
      'SELECT * FROM adult_bmi_records WHERE bmi_id = ?',
      [newId]
    );

    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('createAdultBMI error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Update adult BMI record
 */
const updateAdultBMI = async (req, res) => {
  try {
    const { id } = req.params;
    const { height_cm, weight_kg, date_recorded } = req.body;
    const userId = req.user.user_id;

    // Get current record
    const [oldRecords] = await pool.query(
      'SELECT * FROM adult_bmi_records WHERE bmi_id = ?',
      [id]
    );

    if (!oldRecords || oldRecords.length === 0) {
      return res.status(404).json({ success: false, message: 'Adult BMI record not found' });
    }

    const oldData = oldRecords[0];

    // Build update
    const updates = [];
    const values = [];

    if (height_cm !== undefined) {
      updates.push('height_cm = ?');
      values.push(height_cm);
    }
    if (weight_kg !== undefined) {
      updates.push('weight_kg = ?');
      values.push(weight_kg);
    }
    if (date_recorded !== undefined) {
      updates.push('date_recorded = ?');
      values.push(date_recorded);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    // If height or weight changed, recalculate BMI and category
    const newHeight = height_cm !== undefined ? height_cm : oldData.height_cm;
    const newWeight = weight_kg !== undefined ? weight_kg : oldData.weight_kg;

    const newBMI = bmiService.calculateBMI(newWeight, newHeight);
    const newCategory = bmiService.classifyAdultBMI(newBMI);

    updates.push('bmi = ?');
    values.push(newBMI);
    updates.push('bmi_category = ?');
    values.push(newCategory);

    values.push(id);

    const sql = `UPDATE adult_bmi_records SET ${updates.join(', ')} WHERE bmi_id = ?`;
    await pool.query(sql, values);

    // Get updated record
    const [rows] = await pool.query(
      'SELECT * FROM adult_bmi_records WHERE bmi_id = ?',
      [id]
    );

    // Audit
    await writeAudit({
      user_id: userId,
      action: 'UPDATE',
      module: 'adult_bmi',
      table_name: 'adult_bmi_records',
      record_id: id,
      old_data: oldData,
      new_data: rows[0]
    });

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('updateAdultBMI error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const deleteAdultBMI = async (req, res) => {
  try {
    const { id } = req.params;
    const [records] = await pool.query('SELECT * FROM adult_bmi_records WHERE bmi_id = ?', [id]);
    if (!records.length) return res.status(404).json({ success: false, message: 'Adult BMI record not found.' });

    await pool.query('DELETE FROM adult_bmi_records WHERE bmi_id = ?', [id]);
    await writeAudit({
      user_id: req.user.user_id,
      action: 'DELETE',
      module: 'adult_bmi',
      table_name: 'adult_bmi_records',
      record_id: id,
      old_data: records[0]
    });
    return res.json({ success: true, message: 'Adult BMI record deleted.' });
  } catch (error) {
    logger.error('deleteAdultBMI error', error);
    return res.status(500).json({ success: false, message: 'Unable to delete Adult BMI record.' });
  }
};

/** Preview an adult BMI assessment without saving it. */
const previewAdultBMI = async (req, res) => {
  try {
    const { resident_id, height_cm, weight_kg, date_recorded } = req.body;
    if (!resident_id || !date_recorded || !height_cm || !weight_kg) {
      return res.status(400).json({ success: false, message: 'Resident, date, height, and weight are required.' });
    }
    const validation = bmiService.validateBMIInput(Number(weight_kg), Number(height_cm));
    if (!validation.valid) {
      const weightError = validation.errors.find((item) => item.toLowerCase().includes('weight'));
      const heightError = validation.errors.find((item) => item.toLowerCase().includes('height'));
      return res.status(400).json({ success: false, message: 'Invalid BMI input', errors: {
        ...(weightError ? { weight_kg: weightError } : {}),
        ...(heightError ? { height_cm: heightError } : {})
      } });
    }
    const [residentRows] = await pool.query('SELECT resident_id, birthdate FROM residents WHERE resident_id = ?', [resident_id]);
    if (!residentRows.length) return res.status(404).json({ success: false, message: 'Resident not found.' });
    const ageYears = ageService.getAgeYears(residentRows[0].birthdate, new Date(`${date_recorded}T00:00:00`));
    if (ageYears < 20) return res.status(400).json({ success: false, message: `Resident is ${ageYears} years old. Adult BMI is for ages 20+.`, errors: { resident_id: 'This resident is outside the adult BMI age range.' } });
    const bmi = bmiService.calculateBMI(Number(weight_kg), Number(height_cm));
    return res.json({ success: true, data: { resident_id: Number(resident_id), age_years: ageYears, height_cm: Number(height_cm), weight_kg: Number(weight_kg), bmi, bmi_category: bmiService.classifyAdultBMI(bmi) } });
  } catch (error) {
    logger.error('previewAdultBMI error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/** Return the latest adult BMI records for history and trend views. */
const getPreviousAdultBMI = async (req, res) => {
  try {
    const residentId = Number(req.params.residentId);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 5));
    if (!Number.isFinite(residentId) || residentId <= 0) return res.status(400).json({ success: false, message: 'A valid resident ID is required.' });
    const [rows] = await pool.query(`SELECT bmi_id, resident_id, weight_kg, height_cm, bmi, bmi_category, date_recorded, created_at FROM adult_bmi_records WHERE resident_id = ? ORDER BY date_recorded DESC, bmi_id DESC LIMIT ?`, [residentId, limit]);
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('getPreviousAdultBMI error', error);
    return res.status(500).json({ success: false, message: 'Unable to load previous measurements.' });
  }
};

module.exports = {
  listAdultBMI,
  getAdultBMI,
  createAdultBMI,
  updateAdultBMI,
  deleteAdultBMI,
  previewAdultBMI,
  getPreviousAdultBMI
};
