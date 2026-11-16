/**
 * Operation Timbang Controller
 * Handles recording and assessment of children 0-59 months
 * Creates both operation_timbang and operation_timbang_assessments records
 */

const pool = require('../config/database');
const { writeAudit } = require('../services/auditService');
const { optPlusService } = require('../services/nutrition');
const logger = require('../services/logger');

const mapValidationErrors = (message) => {
  const text = String(message || '');
  const errors = {};
  if (/resident|child/i.test(text)) errors.resident_id = text;
  if (/measurement date|date/i.test(text) && !errors.resident_id) errors.date_recorded = text;
  if (/weight/i.test(text)) errors.weight_kg = text;
  if (/height|length/i.test(text) && !/birthdate/i.test(text)) errors.measurement_cm = text;
  if (/measurement type|standing-height|recumbent/i.test(text)) errors.measurement_type = text;
  return Object.keys(errors).length ? errors : undefined;
};

const getResidentAssessment = async (input = {}) => {
  if (!input || typeof input !== 'object') {
    const error = new Error('Measurement details are required.');
    error.statusCode = 400;
    throw error;
  }
  const residentId = Number(input.resident_id);
  if (!Number.isInteger(residentId) || residentId <= 0) {
    const error = new Error('Select a valid resident.');
    error.statusCode = 400;
    throw error;
  }

  const [residents] = await pool.query(
    "SELECT resident_id, DATE_FORMAT(birthdate, '%Y-%m-%d') AS birthdate, sex FROM residents WHERE resident_id = ?",
    [residentId]
  );
  if (!residents.length) {
    const error = new Error('Resident not found.');
    error.statusCode = 400;
    throw error;
  }

  const resident = residents[0];
  const assessment = optPlusService.calculateOperationTimbang({
    ...input,
    birthdate: resident.birthdate,
    sex: resident.sex,
  });
  return { resident, assessment };
};

const calculateOperationTimbang = async (req, res) => {
  try {
    const { resident, assessment } = await getResidentAssessment(req.body);
    return res.json({
      success: true,
      data: {
        resident_id: resident.resident_id,
        date_recorded: req.body.date_recorded,
        weight_kg: Number(req.body.weight_kg),
        measurement_cm: Number(req.body.measurement_cm),
        measurement_type: req.body.measurement_type,
        ...assessment,
      },
    });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ success: false, message: error.message, errors: mapValidationErrors(error.message) });
    logger.error('calculateOperationTimbang error', error);
    return res.status(500).json({ success: false, message: 'Unable to calculate nutritional status. Please try again.' });
  }
};

/**
 * List operation timbang records with pagination
 */
const listOperationTimbang = async (req, res) => {
  try {
    const { page = 1, limit = 25, resident_id, startDate, endDate } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const orderBy = req.query.sort === 'created_at'
      ? 'ot.created_at DESC, ot.timbang_id DESC'
      : 'ot.date_recorded DESC, ot.timbang_id DESC';

    let where = 'WHERE 1=1';
    const params = [];

    if (resident_id) {
      where += ' AND ot.resident_id = ?';
      params.push(Number(resident_id));
    }

    if (startDate) {
      where += ' AND ot.date_recorded >= ?';
      params.push(startDate);
    }

    if (endDate) {
      where += ' AND ot.date_recorded <= ?';
      params.push(endDate);
    }

    // Get total
    const countSql = `SELECT COUNT(*) as total FROM operation_timbang ot ${where}`;
    const [countRows] = await pool.query(countSql, params);
    const total = countRows[0].total;

    // Get records
    const sql = `
      SELECT 
        ot.timbang_id,
        ot.resident_id,
        ot.weight_kg,
        ot.measurement_cm,
        ot.measurement_type,
        ot.date_recorded,
        ot.recorded_by,
        u.full_name as recorded_by_name,
        r.first_name,
        r.last_name,
        r.birthdate,
        ot.created_at,
        ota.assessment_id,
        ota.age_in_months,
        ota.wfa_zscore,
        ota.wfa_status,
        ota.hfa_zscore,
        ota.hfa_status,
        ota.wflh_zscore,
        ota.wflh_status
      FROM operation_timbang ot
      LEFT JOIN users u ON ot.recorded_by = u.user_id
      LEFT JOIN residents r ON ot.resident_id = r.resident_id
      LEFT JOIN operation_timbang_assessments ota ON ot.timbang_id = ota.timbang_id
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
    logger.error('listOperationTimbang error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Get single operation timbang record with assessment
 */
const getOperationTimbang = async (req, res) => {
  try {
    const { id } = req.params;

    const sql = `
      SELECT 
        ot.*,
        r.first_name,
        r.last_name,
        r.birthdate,
        r.sex,
        u.full_name as recorded_by_name,
        ota.assessment_id,
        ota.age_in_months,
        ota.wfa_zscore,
        ota.wfa_status,
        ota.hfa_zscore,
        ota.hfa_status,
        ota.wflh_zscore,
        ota.wflh_status,
        ota.assessed_at
      FROM operation_timbang ot
      LEFT JOIN residents r ON ot.resident_id = r.resident_id
      LEFT JOIN users u ON ot.recorded_by = u.user_id
      LEFT JOIN operation_timbang_assessments ota ON ot.timbang_id = ota.timbang_id
      WHERE ot.timbang_id = ?
    `;

    const [rows] = await pool.query(sql, [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Operation Timbang record not found' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('getOperationTimbang error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Create operation timbang record with automatic OPT Plus assessment
 * This is a transaction: creates both timbang and assessment records
 */
const createOperationTimbang = async (req, res) => {
  let conn;
  let transactionActive = false;
  try {
    const { resident, assessment } = await getResidentAssessment(req.body);
    const residentId = resident.resident_id;
    const weightKg = Number(req.body.weight_kg);
    const measurementCm = Number(req.body.measurement_cm);
    const { measurement_type: measurementType, date_recorded: dateRecorded } = req.body;
    const userId = req.user.user_id;

    conn = await pool.getConnection();
    await conn.beginTransaction();
    transactionActive = true;
    try {
      const [timbangResult] = await conn.query(
        `INSERT INTO operation_timbang
          (resident_id, weight_kg, measurement_cm, measurement_type, date_recorded, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [residentId, weightKg, measurementCm, measurementType, dateRecorded, userId]
      );
      const timbangId = timbangResult.insertId;
      const [assessmentResult] = await conn.query(
        `INSERT INTO operation_timbang_assessments
          (timbang_id, age_in_months, wfa_zscore, wfa_status, hfa_zscore, hfa_status, wflh_zscore, wflh_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          timbangId,
          assessment.age_in_months,
          assessment.wfa_zscore,
          assessment.wfa_status,
          assessment.hfa_zscore,
          assessment.hfa_status,
          assessment.wflh_zscore,
          assessment.wflh_status,
        ]
      );
      await conn.commit();
      transactionActive = false;

      await writeAudit({
        user_id: userId,
        action: 'CREATE',
        module: 'operation_timbang',
        table_name: 'operation_timbang',
        record_id: timbangId,
        new_data: { resident_id: residentId, weight_kg: weightKg, measurement_cm: measurementCm, measurement_type: measurementType, date_recorded: dateRecorded },
      });
      await writeAudit({
        user_id: userId,
        action: 'CREATE',
        module: 'operation_timbang',
        table_name: 'operation_timbang_assessments',
        record_id: assessmentResult.insertId,
        new_data: { timbang_id: timbangId, ...assessment },
      });

      const [fullRecord] = await conn.query(
        `SELECT ot.*, ota.assessment_id, ota.age_in_months, ota.wfa_zscore, ota.wfa_status,
          ota.hfa_zscore, ota.hfa_status, ota.wflh_zscore, ota.wflh_status
         FROM operation_timbang ot
         LEFT JOIN operation_timbang_assessments ota ON ot.timbang_id = ota.timbang_id
         WHERE ot.timbang_id = ?`,
        [timbangId]
      );
      return res.status(201).json({ success: true, data: fullRecord[0] });
    } catch (error) {
      if (transactionActive) {
        try {
          await conn.rollback();
          transactionActive = false;
        } catch (rollbackError) {
          logger.error('createOperationTimbang rollback error', rollbackError);
        }
      }
      throw error;
    }
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ success: false, message: error.message, errors: mapValidationErrors(error.message) });
    logger.error('createOperationTimbang error', error);
    return res.status(500).json({ success: false, message: 'Unable to save Operation Timbang record.' });
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Update operation timbang record
 */
const updateOperationTimbang = async (req, res) => {
  let conn;
  let transactionActive = false;
  try {
    const { id } = req.params;
    const { weight_kg, measurement_cm, measurement_type, date_recorded } = req.body;
    const userId = req.user.user_id;
    conn = await pool.getConnection();
    await conn.beginTransaction();
    transactionActive = true;
    const [oldRecords] = await conn.query('SELECT * FROM operation_timbang WHERE timbang_id = ?', [id]);
    if (!oldRecords || oldRecords.length === 0) {
      await conn.rollback();
      transactionActive = false;
      return res.status(404).json({ success: false, message: 'Operation Timbang record not found' });
    }
    const oldData = oldRecords[0];
    if ([weight_kg, measurement_cm, measurement_type, date_recorded].every((value) => value === undefined)) {
      await conn.rollback();
      transactionActive = false;
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }
    const updatedRecord = {
      ...oldData,
      ...(weight_kg !== undefined ? { weight_kg } : {}),
      ...(measurement_cm !== undefined ? { measurement_cm } : {}),
      ...(measurement_type !== undefined ? { measurement_type } : {}),
      ...(date_recorded !== undefined ? { date_recorded } : {}),
    };
    const { assessment } = await getResidentAssessment({
      resident_id: oldData.resident_id,
      date_recorded: updatedRecord.date_recorded,
      weight_kg: updatedRecord.weight_kg,
      measurement_cm: updatedRecord.measurement_cm,
      measurement_type: updatedRecord.measurement_type,
    });
    const updateFields = ['weight_kg', 'measurement_cm', 'measurement_type', 'date_recorded'];
    await conn.query(
      `UPDATE operation_timbang SET ${updateFields.map((field) => `${field} = ?`).join(', ')} WHERE timbang_id = ?`,
      [updatedRecord.weight_kg, updatedRecord.measurement_cm, updatedRecord.measurement_type, updatedRecord.date_recorded, id]
    );
    const [assessmentRows] = await conn.query(
      'SELECT assessment_id FROM operation_timbang_assessments WHERE timbang_id = ?',
      [id]
    );
    const assessmentValues = [
      assessment.age_in_months,
      assessment.wfa_zscore,
      assessment.wfa_status,
      assessment.hfa_zscore,
      assessment.hfa_status,
      assessment.wflh_zscore,
      assessment.wflh_status,
    ];
    if (assessmentRows.length) {
      await conn.query(
        `UPDATE operation_timbang_assessments
         SET age_in_months = ?, wfa_zscore = ?, wfa_status = ?, hfa_zscore = ?, hfa_status = ?, wflh_zscore = ?, wflh_status = ?
         WHERE timbang_id = ?`,
        [...assessmentValues, id]
      );
    } else {
      await conn.query(
        `INSERT INTO operation_timbang_assessments
          (timbang_id, age_in_months, wfa_zscore, wfa_status, hfa_zscore, hfa_status, wflh_zscore, wflh_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ...assessmentValues]
      );
    }
    await conn.commit();
    transactionActive = false;
    const [rows] = await conn.query(
      `SELECT ot.*, ota.assessment_id, ota.age_in_months, ota.wfa_zscore, ota.wfa_status,
        ota.hfa_zscore, ota.hfa_status, ota.wflh_zscore, ota.wflh_status
       FROM operation_timbang ot
       LEFT JOIN operation_timbang_assessments ota ON ot.timbang_id = ota.timbang_id
       WHERE ot.timbang_id = ?`,
      [id]
    );
    await writeAudit({
      user_id: userId,
      action: 'UPDATE',
      module: 'operation_timbang',
      table_name: 'operation_timbang',
      record_id: id,
      old_data: oldData,
      new_data: rows[0]
    });
    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    if (conn && transactionActive) {
      try {
        await conn.rollback();
        transactionActive = false;
      } catch (rollbackError) {
        logger.error('updateOperationTimbang rollback error', rollbackError);
      }
    }
    if (error.statusCode === 400) return res.status(400).json({ success: false, message: error.message });
    logger.error('updateOperationTimbang error', error);
    return res.status(500).json({ success: false, message: 'Unable to update Operation Timbang record.' });
  } finally {
    if (conn) conn.release();
  }
};

const listPreviousMeasurements = async (req, res) => {
  try {
    const residentId = Number(req.params.residentId);
    if (!Number.isInteger(residentId) || residentId <= 0) {
      return res.status(400).json({ success: false, message: 'A valid resident is required.', errors: { resident_id: 'Select a valid child.' } });
    }
    const limit = Math.min(12, Math.max(1, Number(req.query.limit) || 12));
    const [rows] = await pool.query(`
      SELECT ot.timbang_id, ot.resident_id, ot.weight_kg, ot.measurement_cm, ot.measurement_type,
        ot.date_recorded, ot.created_at, ota.age_in_months, ota.wfa_zscore, ota.wfa_status,
        ota.hfa_zscore, ota.hfa_status, ota.wflh_zscore, ota.wflh_status
      FROM operation_timbang ot
      LEFT JOIN operation_timbang_assessments ota ON ot.timbang_id = ota.timbang_id
      WHERE ot.resident_id = ?
      ORDER BY ot.date_recorded DESC, ot.timbang_id DESC
      LIMIT ?
    `, [residentId, limit]);
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('listPreviousMeasurements error', error);
    return res.status(500).json({ success: false, message: 'Unable to load previous measurements.' });
  }
};

const deleteOperationTimbang = async (req, res) => {
  let conn;
  let transactionActive = false;
  try {
    const { id } = req.params;
    conn = await pool.getConnection();
    await conn.beginTransaction();
    transactionActive = true;

    const [records] = await conn.query('SELECT * FROM operation_timbang WHERE timbang_id = ?', [id]);
    if (!records.length) {
      await conn.rollback();
      transactionActive = false;
      return res.status(404).json({ success: false, message: 'Operation Timbang record not found.' });
    }
    const [assessments] = await conn.query('SELECT * FROM operation_timbang_assessments WHERE timbang_id = ?', [id]);
    await conn.query('DELETE FROM operation_timbang_assessments WHERE timbang_id = ?', [id]);
    await conn.query('DELETE FROM operation_timbang WHERE timbang_id = ?', [id]);
    await conn.commit();
    transactionActive = false;

    await writeAudit({
      user_id: req.user.user_id,
      action: 'DELETE',
      module: 'operation_timbang',
      table_name: 'operation_timbang',
      record_id: id,
      old_data: records[0]
    });
    if (assessments.length) {
      await writeAudit({
        user_id: req.user.user_id,
        action: 'DELETE',
        module: 'operation_timbang',
        table_name: 'operation_timbang_assessments',
        record_id: assessments[0].assessment_id,
        old_data: assessments[0]
      });
    }
    return res.json({ success: true, message: 'Operation Timbang record deleted.' });
  } catch (error) {
    if (conn && transactionActive) {
      try {
        await conn.rollback();
        transactionActive = false;
      } catch (rollbackError) {
        logger.error('deleteOperationTimbang rollback error', rollbackError);
      }
    }
    logger.error('deleteOperationTimbang error', error);
    return res.status(500).json({ success: false, message: 'Unable to delete Operation Timbang record.' });
  } finally {
    if (conn) conn.release();
  }
};

module.exports = {
  listOperationTimbang,
  getOperationTimbang,
  calculateOperationTimbang,
  createOperationTimbang,
  updateOperationTimbang,
  deleteOperationTimbang,
  listPreviousMeasurements
};
