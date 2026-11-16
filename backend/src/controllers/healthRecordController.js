/**
 * Health Records Controller
 * Handles CRUD operations for health records
 */

const pool = require('../config/database');
const { writeAudit } = require('../services/auditService');
const logger = require('../services/logger');

/**
 * List health records with filtering and pagination
 */
const clinicalFieldMap = {
  resident_id: 'hr.resident_id',
  record_date: 'hr.record_date',
  record_type: 'hr.record_type',
  chief_complaint: 'hr.chief_complaint',
  history_of_present_illness: 'hr.history_of_present_illness',
  past_medical_history: 'hr.past_medical_history',
  allergies: 'hr.allergies',
  family_medical_history: 'hr.family_medical_history',
  personal_social_history: 'hr.personal_social_history',
  blood_pressure: 'hr.blood_pressure',
  heart_rate: 'hr.heart_rate',
  respiratory_rate: 'hr.respiratory_rate',
  temperature: 'hr.temperature',
  weight_kg: 'hr.weight_kg',
  height_cm: 'hr.height_cm',
  findings: 'hr.findings',
  assessment: 'hr.assessment',
  plan: 'hr.plan',
  maintenance_medications: 'hr.maintenance_medications',
  past_surgical_history: 'hr.past_surgical_history',
  immunization_history: 'hr.immunization_history',
  family_planning_history: 'hr.family_planning_history',
  menstrual_history: 'hr.menstrual_history',
  pregnancy_history: 'hr.pregnancy_history',
  remarks: 'hr.remarks'
};

const clinicalInsertFields = [
  'resident_id', 'record_date', 'record_type', 'chief_complaint', 'history_of_present_illness',
  'past_medical_history', 'allergies', 'family_medical_history', 'personal_social_history',
  'blood_pressure', 'heart_rate', 'respiratory_rate', 'temperature', 'weight_kg', 'height_cm',
  'findings', 'assessment', 'plan', 'maintenance_medications', 'past_surgical_history',
  'immunization_history', 'family_planning_history', 'menstrual_history', 'pregnancy_history', 'remarks', 'recorded_by'
];

const recordSources = [
  { table: 'health_records', type: 'clinical', label: 'Clinical Record' },
  { table: 'child_health_records', type: 'child', label: 'Child Record' },
  { table: 'patient_clinical_records', type: 'clinical', label: 'Clinical Record', json: true },
  { table: 'child_records', type: 'child', label: 'Child Record', json: true },
  { table: 'maternal_records', type: 'maternal', label: 'Maternal Record', json: true },
  { table: 'immunization_records', type: 'immunization', label: 'Immunization Record', json: true }
];

const jsonValue = (field) => `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(mr.record_data, '$.${field}')), '')`;
const sqlText = (expression) => `CONVERT(CAST(COALESCE(${expression}, '') AS CHAR) USING utf8mb4)`;

const buildRecordsUnion = () => recordSources.map(({ table, type, label, json }) => {
  if (json) {
    const dateFields = type === 'immunization'
      ? ['newborn_screening_date', 'hearing_screening_date', 'vitamin_k_date', 'bcg_date', 'hepa_b1_within_24_hours_date', 'hepa_b1_after_24_hours_date', 'mcvo_date', 'measles_date', 'mmr_date', 'vitamin_a_first_dose_date', 'vitamin_a_second_dose_date', 'visit_date']
      : ['visit_date'];
    const summaryFields = type === 'clinical'
      ? ['assessment', 'chief_complaint', 'history_of_present_illness', 'notes', 'findings', 'plan']
      : type === 'child'
        ? ['assessment', 'history_of_present_illness', 'birth_and_immunization_history', 'immunization_history', 'notes', 'remarks']
        : type === 'maternal'
          ? ['assessment', 'chief_complaint', 'tt_status', 'notes', 'visit_date']
          : ['vaccine_summary', 'notes', 'assessment'];
    return `
      SELECT mr.id AS record_id, mr.resident_id,
        ${sqlText('r.first_name')} AS first_name, ${sqlText('r.middle_name')} AS middle_name,
        ${sqlText('r.last_name')} AS last_name, ${sqlText('r.suffix')} AS suffix,
        r.birthdate, ${sqlText('r.sex')} AS sex, ${sqlText('r.household_no')} AS household_no,
        ${sqlText('r.profile_photo')} AS profile_photo,
        TIMESTAMPDIFF(YEAR, r.birthdate, CURDATE()) AS age,
        ${sqlText(`COALESCE(${dateFields.map(jsonValue).join(', ')}, DATE_FORMAT(mr.created_at, '%Y-%m-%d'))`)} AS record_date,
        ${sqlText(`'${type}'`)} AS record_type, ${sqlText(`'${label}'`)} AS record_label,
        ${sqlText(`COALESCE(${summaryFields.map(jsonValue).join(', ')}, ${type === 'immunization' ? "'Vaccine record'" : "'-'"})`)} AS summary,
        ${sqlText(`'${table}'`)} AS source_table, mr.created_at, mr.updated_at, mr.recorded_by,
        ${sqlText('u.full_name')} AS recorded_by_name,
        ${sqlText('CAST(mr.record_data AS CHAR)')} AS search_text
      FROM \`${table}\` mr
      JOIN residents r ON r.resident_id = mr.resident_id
      LEFT JOIN users u ON u.user_id = mr.recorded_by`;
  }

  const isClinical = type === 'clinical';
  const idColumn = isClinical ? 'health_record_id' : 'id';
  const alias = isClinical ? 'hr' : 'chr';
  const tableAlias = alias;
  const dateColumn = `${tableAlias}.record_date`;
  const summaryColumns = isClinical
    ? ['assessment', 'chief_complaint', 'notes', 'history_of_present_illness', 'findings', 'plan']
    : ['assessment', 'history_of_present_illness', 'immunization_history', 'remarks', 'findings'];
  const searchableColumns = isClinical
    ? ['notes', 'assessment', 'chief_complaint', 'history_of_present_illness', 'findings', 'plan']
    : ['assessment', 'history_of_present_illness', 'immunization_history', 'remarks', 'findings'];
  return `
    SELECT ${tableAlias}.${idColumn} AS record_id, ${tableAlias}.resident_id,
      ${sqlText('r.first_name')} AS first_name, ${sqlText('r.middle_name')} AS middle_name,
      ${sqlText('r.last_name')} AS last_name, ${sqlText('r.suffix')} AS suffix,
      r.birthdate, ${sqlText('r.sex')} AS sex, ${sqlText('r.household_no')} AS household_no,
      ${sqlText('r.profile_photo')} AS profile_photo,
      TIMESTAMPDIFF(YEAR, r.birthdate, CURDATE()) AS age,
      ${sqlText(`DATE_FORMAT(${dateColumn}, '%Y-%m-%d')`)} AS record_date,
      ${sqlText(`'${type}'`)} AS record_type, ${sqlText(`'${label}'`)} AS record_label,
      ${sqlText(`COALESCE(${summaryColumns.map((column) => `NULLIF(${tableAlias}.${column}, '')`).join(', ')}, '-')`)} AS summary,
      ${sqlText(`'${table}'`)} AS source_table, ${tableAlias}.created_at, ${tableAlias}.updated_at, ${tableAlias}.recorded_by,
      ${sqlText('u.full_name')} AS recorded_by_name,
      ${sqlText(`CONCAT_WS(' ', ${searchableColumns.map((column) => `${tableAlias}.${column}`).join(', ')})`)} AS search_text
    FROM ${table} ${tableAlias}
    JOIN residents r ON r.resident_id = ${tableAlias}.resident_id
    LEFT JOIN users u ON u.user_id = ${tableAlias}.recorded_by`;
}).join(' UNION ALL ');

const listAllHealthRecords = async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const requestedSize = Number.parseInt(req.query.pageSize || req.query.limit, 10) || 10;
  const pageSize = [10, 25, 50].includes(requestedSize) ? requestedSize : 10;
  const search = String(req.query.search || '').trim();
  const recordType = String(req.query.type || req.query.record_type || '').trim();
  const startDate = String(req.query.from || req.query.startDate || '').trim();
  const endDate = String(req.query.to || req.query.endDate || '').trim();
  const sort = String(req.query.sort || 'date');
  const order = String(req.query.order || 'desc').toLowerCase();
  const validTypes = ['clinical', 'child', 'maternal', 'immunization'];
  const validDate = (value) => {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const sortColumns = { date: 'record_date', record_date: 'record_date', resident: "CONCAT_WS(' ', last_name, first_name, middle_name)", type: 'record_type', record_type: 'record_type' };
  if ((recordType && !validTypes.includes(recordType)) || !validDate(startDate) || !validDate(endDate) ||
      (startDate && endDate && startDate > endDate) || !sortColumns[sort] || !['asc', 'desc'].includes(order)) {
    return res.status(400).json({ success: false, message: 'Invalid health record filters.' });
  }

  const unionSql = buildRecordsUnion();
  const commonFilters = [
    `(? = '' OR CONCAT_WS(' ', first_name, middle_name, last_name, suffix, record_label, record_type, record_date, summary, search_text) LIKE ?)`,
    `(? = '' OR record_date >= ?)`,
    `(? = '' OR record_date <= ?)`
  ].join(' AND ');
  const commonParams = [search, `%${search}%`, startDate, startDate, endDate, endDate];
  const filters = `${commonFilters} AND (? = '' OR record_type = ?)`;
  const filterParams = [...commonParams, recordType, recordType];
  const offset = (page - 1) * pageSize;
  const sortSql = sortColumns[sort];

  try {
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM (${unionSql}) records WHERE ${filters}`, filterParams);
    const total = Number(countRows[0]?.total || 0);
    const [countByType] = await pool.query(
      `SELECT record_type, COUNT(*) AS total FROM (${unionSql}) records WHERE ${commonFilters} GROUP BY record_type`,
      commonParams
    );
    const [rows] = await pool.query(
      `SELECT * FROM (${unionSql}) records WHERE ${filters} ORDER BY ${sortSql} ${order.toUpperCase()}, created_at DESC, record_id DESC LIMIT ? OFFSET ?`,
      [...filterParams, pageSize, offset]
    );
    const typeCounts = Object.fromEntries(validTypes.map((type) => [type, 0]));
    countByType.forEach((row) => { typeCounts[row.record_type] = Number(row.total); });
    const totalPages = Math.ceil(total / pageSize);
    return res.json({
      success: true,
      data: { items: rows, total, page, pageSize, limit: pageSize, typeCounts, pagination: { page, limit: pageSize, total, totalPages } }
    });
  } catch (error) {
    logger.error('listAllHealthRecords error', error);
    return res.status(500).json({ success: false, message: 'Unable to load health records.' });
  }
};

const getHealthRecordDetails = async (req, res) => {
  const { sourceTable, recordId: rawRecordId } = req.params;
  const source = recordSources.find((item) => item.table === sourceTable);
  const recordId = Number(rawRecordId);
  if (!source || !Number.isSafeInteger(recordId) || recordId < 1) {
    return res.status(400).json({ success: false, message: 'Invalid health record.' });
  }
  try {
    const idColumn = sourceTable === 'health_records' ? 'health_record_id' : 'id';
    const recordQuery = source.json
      ? `SELECT mr.id, mr.resident_id, mr.record_data, mr.recorded_by, mr.created_at, mr.updated_at,
          u.full_name AS recorded_by_name, r.first_name, r.middle_name, r.last_name, r.suffix,
          r.birthdate, r.sex, r.household_no, r.profile_photo,
          TIMESTAMPDIFF(YEAR, r.birthdate, CURDATE()) AS age
        FROM \`${sourceTable}\` mr JOIN residents r ON r.resident_id = mr.resident_id
        LEFT JOIN users u ON u.user_id = mr.recorded_by WHERE mr.id = ?`
      : `SELECT ${sourceTable === 'health_records' ? 'hr.*' : 'chr.*'},
          u.full_name AS recorded_by_name, r.first_name, r.middle_name, r.last_name, r.suffix,
          r.birthdate, r.sex, r.household_no, r.profile_photo,
          TIMESTAMPDIFF(YEAR, r.birthdate, CURDATE()) AS age
        FROM \`${sourceTable}\` ${sourceTable === 'health_records' ? 'hr' : 'chr'}
        JOIN residents r ON r.resident_id = ${sourceTable === 'health_records' ? 'hr' : 'chr'}.resident_id
        LEFT JOIN users u ON u.user_id = ${sourceTable === 'health_records' ? 'hr' : 'chr'}.recorded_by
        WHERE ${sourceTable === 'health_records' ? 'hr.health_record_id' : 'chr.id'} = ?`;
    const [recordRows] = await pool.query(recordQuery, [recordId]);
    if (!recordRows.length) return res.status(404).json({ success: false, message: 'Health record not found.' });
    const record = recordRows[0];
    if (source.json && typeof record.record_data === 'string') record.record_data = JSON.parse(record.record_data);
    const [residentRows] = await pool.query(
      `SELECT * FROM (${buildRecordsUnion()}) records WHERE resident_id = ? ORDER BY record_date DESC, created_at DESC, record_id DESC`,
      [record.resident_id]
    );
    const currentIndex = residentRows.findIndex((item) => item.source_table === sourceTable && Number(item.record_id) === recordId);
    const selected = residentRows[currentIndex];
    const getRecordKey = (item) => ({ type: item.record_type, sourceTable: item.source_table, recordId: item.record_id });
    return res.json({
      success: true,
      data: {
        record: { ...record, record_type: source.type, record_label: source.label, source_table: source.table, record_date: selected?.record_date || record.record_date || record.visit_date || record.record_data?.visit_date || null },
        resident: {
          resident_id: record.resident_id, first_name: record.first_name, middle_name: record.middle_name,
          last_name: record.last_name, suffix: record.suffix, birthdate: record.birthdate, sex: record.sex,
          age: record.age, household_no: record.household_no, profile_photo: record.profile_photo
        },
        previousRecord: currentIndex > 0 ? getRecordKey(residentRows[currentIndex - 1]) : null,
        nextRecord: currentIndex >= 0 && currentIndex < residentRows.length - 1 ? getRecordKey(residentRows[currentIndex + 1]) : null,
        otherRecords: residentRows.filter((item) => !(item.source_table === sourceTable && Number(item.record_id) === recordId)).slice(0, 5)
      }
    });
  } catch (error) {
    logger.error('getHealthRecordDetails error', error);
    return res.status(500).json({ success: false, message: 'Unable to load health record.' });
  }
};

const listHealthRecords = async (req, res) => {
  try {
    const { page = 1, limit = 25, resident_id, record_type, startDate, endDate } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let where = 'WHERE 1=1';
    const params = [];

    if (resident_id) {
      where += ' AND hr.resident_id = ?';
      params.push(Number(resident_id));
    }

    if (record_type) {
      where += ' AND record_type = ?';
      params.push(record_type);
    }

    if (startDate) {
      where += ' AND record_date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      where += ' AND record_date <= ?';
      params.push(endDate);
    }

    // Get total count
    const countSql = `SELECT COUNT(*) as total FROM health_records hr ${where}`;
    const [countRows] = await pool.query(countSql, params);
    const total = countRows[0].total;

    // Get paginated results
    const sql = `
      SELECT 
        hr.health_record_id,
        hr.resident_id,
        hr.record_date,
        hr.record_type,
        hr.chief_complaint,
        hr.history_of_present_illness,
        hr.past_medical_history,
        hr.allergies,
        hr.family_medical_history,
        hr.blood_pressure,
        hr.heart_rate,
        hr.respiratory_rate,
        hr.temperature,
        hr.weight_kg,
        hr.height_cm,
        hr.findings,
        hr.assessment,
        hr.plan,
        hr.notes,
        hr.recorded_by,
        u.full_name as recorded_by_name,
        r.first_name,
        r.last_name,
        hr.created_at
      FROM health_records hr
      LEFT JOIN users u ON hr.recorded_by = u.user_id
      LEFT JOIN residents r ON hr.resident_id = r.resident_id
      ${where}
      ORDER BY hr.record_date DESC, hr.health_record_id DESC
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
    logger.error('listHealthRecords error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Get single health record
 */
const getHealthRecord = async (req, res) => {
  try {
    const { id } = req.params;

    const sql = `
      SELECT 
        hr.*,
        r.first_name,
        r.last_name,
        r.birthdate,
        r.sex,
        u.full_name as recorded_by_name
      FROM health_records hr
      LEFT JOIN residents r ON hr.resident_id = r.resident_id
      LEFT JOIN users u ON hr.recorded_by = u.user_id
      WHERE hr.health_record_id = ?
    `;

    const [rows] = await pool.query(sql, [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Health record not found' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('getHealthRecord error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Create health record
 */
const createHealthRecord = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const {
      resident_id,
      record_date,
      record_type,
      chief_complaint,
      history_of_present_illness,
      past_medical_history,
      allergies,
      family_medical_history,
      personal_social_history,
      blood_pressure,
      heart_rate,
      respiratory_rate,
      temperature,
      weight_kg,
      height_cm,
      findings,
      assessment,
      plan,
      maintenance_medications,
      past_surgical_history,
      immunization_history,
      family_planning_history,
      menstrual_history,
      pregnancy_history,
      remarks,
      notes,
      medical_history
    } = req.body;

    // Validate required fields
    if (!resident_id) {
      return res.status(400).json({ success: false, message: 'Resident ID is required' });
    }

    if (!record_date) {
      return res.status(400).json({ success: false, message: 'Record date is required' });
    }

    // Verify resident exists
    const [residentCheck] = await pool.query(
      'SELECT resident_id FROM residents WHERE resident_id = ?',
      [resident_id]
    );

    if (!residentCheck || residentCheck.length === 0) {
      return res.status(400).json({ success: false, message: 'Resident not found' });
    }

    // Insert record
    const sql = `
      INSERT INTO health_records 
        (resident_id, record_date, record_type, chief_complaint, history_of_present_illness, past_medical_history,
         allergies, family_medical_history, personal_social_history, blood_pressure, heart_rate, respiratory_rate,
         temperature, weight_kg, height_cm, findings, assessment, plan, maintenance_medications,
         past_surgical_history, immunization_history, family_planning_history, menstrual_history, pregnancy_history,
         remarks, medical_history, notes, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(sql, [
      resident_id,
      record_date,
      record_type || null,
      chief_complaint || null,
      history_of_present_illness || null,
      past_medical_history || null,
      allergies || null,
      family_medical_history || null,
      personal_social_history || null,
      blood_pressure || null,
      heart_rate || null,
      respiratory_rate || null,
      temperature !== undefined && temperature !== '' && temperature !== null ? Number(temperature) : null,
      weight_kg !== undefined && weight_kg !== '' && weight_kg !== null ? Number(weight_kg) : null,
      height_cm !== undefined && height_cm !== '' && height_cm !== null ? Number(height_cm) : null,
      findings || null,
      assessment || null,
      plan || null,
      maintenance_medications || null,
      past_surgical_history || null,
      immunization_history || null,
      family_planning_history || null,
      menstrual_history || null,
      pregnancy_history || null,
      remarks || null,
      medical_history || null,
      notes || null,
      userId
    ]);

    const newId = result.insertId;

    // Audit
    await writeAudit({
      user_id: userId,
      action: 'CREATE',
      module: 'health_records',
      table_name: 'health_records',
      record_id: newId,
      new_data: { resident_id, record_date, record_type, medical_history, notes }
    });

    // Get full record
    const [rows] = await pool.query(
      'SELECT * FROM health_records WHERE health_record_id = ?',
      [newId]
    );

    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('createHealthRecord error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Update health record
 */
const updateHealthRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.user_id;
    const {
      record_date,
      record_type,
      chief_complaint,
      history_of_present_illness,
      past_medical_history,
      allergies,
      family_medical_history,
      personal_social_history,
      blood_pressure,
      heart_rate,
      respiratory_rate,
      temperature,
      weight_kg,
      height_cm,
      findings,
      assessment,
      plan,
      maintenance_medications,
      past_surgical_history,
      immunization_history,
      family_planning_history,
      menstrual_history,
      pregnancy_history,
      remarks,
      medical_history,
      notes
    } = req.body;

    // Get current record for audit
    const [oldRecords] = await pool.query(
      'SELECT * FROM health_records WHERE health_record_id = ?',
      [id]
    );

    if (!oldRecords || oldRecords.length === 0) {
      return res.status(404).json({ success: false, message: 'Health record not found' });
    }

    const oldData = oldRecords[0];

    // Build update
    const updates = [];
    const values = [];

    if (record_date !== undefined) {
      updates.push('record_date = ?');
      values.push(record_date);
    }
    if (record_type !== undefined) {
      updates.push('record_type = ?');
      values.push(record_type);
    }
    if (chief_complaint !== undefined) updates.push('chief_complaint = ?'), values.push(chief_complaint || null);
    if (history_of_present_illness !== undefined) updates.push('history_of_present_illness = ?'), values.push(history_of_present_illness || null);
    if (past_medical_history !== undefined) updates.push('past_medical_history = ?'), values.push(past_medical_history || null);
    if (allergies !== undefined) updates.push('allergies = ?'), values.push(allergies || null);
    if (family_medical_history !== undefined) updates.push('family_medical_history = ?'), values.push(family_medical_history || null);
    if (personal_social_history !== undefined) updates.push('personal_social_history = ?'), values.push(personal_social_history || null);
    if (blood_pressure !== undefined) updates.push('blood_pressure = ?'), values.push(blood_pressure || null);
    if (heart_rate !== undefined) updates.push('heart_rate = ?'), values.push(heart_rate || null);
    if (respiratory_rate !== undefined) updates.push('respiratory_rate = ?'), values.push(respiratory_rate || null);
    if (temperature !== undefined) updates.push('temperature = ?'), values.push(temperature !== '' && temperature !== null ? Number(temperature) : null);
    if (weight_kg !== undefined) updates.push('weight_kg = ?'), values.push(weight_kg !== '' && weight_kg !== null ? Number(weight_kg) : null);
    if (height_cm !== undefined) updates.push('height_cm = ?'), values.push(height_cm !== '' && height_cm !== null ? Number(height_cm) : null);
    if (findings !== undefined) updates.push('findings = ?'), values.push(findings || null);
    if (assessment !== undefined) updates.push('assessment = ?'), values.push(assessment || null);
    if (plan !== undefined) updates.push('plan = ?'), values.push(plan || null);
    if (maintenance_medications !== undefined) updates.push('maintenance_medications = ?'), values.push(maintenance_medications || null);
    if (past_surgical_history !== undefined) updates.push('past_surgical_history = ?'), values.push(past_surgical_history || null);
    if (immunization_history !== undefined) updates.push('immunization_history = ?'), values.push(immunization_history || null);
    if (family_planning_history !== undefined) updates.push('family_planning_history = ?'), values.push(family_planning_history || null);
    if (menstrual_history !== undefined) updates.push('menstrual_history = ?'), values.push(menstrual_history || null);
    if (pregnancy_history !== undefined) updates.push('pregnancy_history = ?'), values.push(pregnancy_history || null);
    if (remarks !== undefined) updates.push('remarks = ?'), values.push(remarks || null);
    if (medical_history !== undefined) updates.push('medical_history = ?'), values.push(medical_history || null);
    if (notes !== undefined) updates.push('notes = ?'), values.push(notes || null);

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    values.push(id);

    const sql = `UPDATE health_records SET ${updates.join(', ')} WHERE health_record_id = ?`;
    await pool.query(sql, values);

    // Get updated record
    const [rows] = await pool.query(
      'SELECT * FROM health_records WHERE health_record_id = ?',
      [id]
    );

    // Audit
    const newData = rows[0];
    await writeAudit({
      user_id: userId,
      action: 'UPDATE',
      module: 'health_records',
      table_name: 'health_records',
      record_id: id,
      old_data: oldData,
      new_data: newData
    });

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('updateHealthRecord error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Delete health record
 */
const deleteHealthRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.user_id;

    // Get record for audit
    const [rows] = await pool.query(
      'SELECT * FROM health_records WHERE health_record_id = ?',
      [id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Health record not found' });
    }

    const oldData = rows[0];

    // Delete
    await pool.query('DELETE FROM health_records WHERE health_record_id = ?', [id]);

    // Audit
    await writeAudit({
      user_id: userId,
      action: 'DELETE',
      module: 'health_records',
      table_name: 'health_records',
      record_id: id,
      old_data: oldData
    });

    return res.json({ success: true, message: 'Health record deleted' });
  } catch (err) {
    logger.error('deleteHealthRecord error', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  listAllHealthRecords,
  getHealthRecordDetails,
  listHealthRecords,
  getHealthRecord,
  createHealthRecord,
  updateHealthRecord,
  deleteHealthRecord
};
