const pool = require('../config/database');
const { writeAudit } = require('../services/auditService');
const logger = require('../services/logger');
const SITIOS = require('../config/sitios');
const { resolveResidentLocation } = require('../services/psgcService');
const { ensureResidentSchema } = require('../services/residentSchemaService');
const { getManilaToday } = require('../services/manilaDateService');

const CIVIL_STATUSES = new Set(['Single', 'Married', 'Widowed', 'Separated', 'Divorced', 'Annulled', 'Unknown']);
const RESIDENT_STATUSES = new Set(['Active', 'Inactive', 'Transferred', 'Deceased']);
const SEXES = new Set(['male', 'female']);
const SORTS = {
  name: 'r.last_name ASC, r.first_name ASC',
  age: 'r.birthdate ASC, r.last_name ASC, r.first_name ASC',
  newest: 'r.created_at DESC, r.resident_id DESC',
  oldest: 'r.created_at ASC, r.resident_id ASC',
  sitio: 'r.sitio ASC, r.last_name ASC, r.first_name ASC',
  status: 'r.resident_status ASC, r.last_name ASC, r.first_name ASC'
};

const RESIDENT_SELECT_SQL = `
  SELECT r.resident_id, r.first_name, r.middle_name, r.last_name, r.suffix,
    r.household_no, r.address, r.region_code, r.province_code, r.city_municipality_code, r.barangay_code,
    r.contact_no, r.philhealth_id_no, r.is_4ps, r.category_flags,
    r.sitio, r.created_by, u.full_name AS created_by_name, r.birthdate, r.sex,
    r.civil_status, r.occupation, r.resident_status, r.pregnant, r.lactating,
    r.profile_photo, r.created_at
  FROM residents r
  LEFT JOIN users u ON u.user_id = r.created_by
`;

function calculateAge(birthdate, asOf = new Date()) {
  if (!birthdate) return null;
  const birth = new Date(`${String(birthdate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = asOf.getFullYear() - birth.getFullYear();
  if (asOf.getMonth() < birth.getMonth() || (asOf.getMonth() === birth.getMonth() && asOf.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function isValidBirthdate(value) {
  const text = String(value || '').slice(0, 10);
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(text);
  if (!match) return false;
  const [year, month, day] = text.split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year ||
      calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day) return false;

  return text <= getManilaToday();
}

function normalizePage(value, fallback) {
  const page = Number.parseInt(value, 10);
  return Number.isFinite(page) && page >= 1 ? page : fallback;
}

function normalizeBoolean(value, fallback = 0) {
  if (value === undefined) return fallback;
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function parseCategoryFlags(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (error) {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function getClassificationWhere(classification) {
  if (classification === 'Senior Citizen') return 'TIMESTAMPDIFF(YEAR, r.birthdate, ?) >= 60';
  if (classification === 'PWD') return "JSON_CONTAINS(COALESCE(r.category_flags, JSON_ARRAY()), JSON_QUOTE('PWD'))";
  if (classification === '4Ps Member' || classification === '4Ps') return 'r.is_4ps = 1';
  if (classification === 'Pregnant') return 'r.pregnant = 1';
  if (classification === 'Lactating') return 'r.lactating = 1';
  return null;
}

function buildWhere(query) {
  const { search, q, sex, status, sitio, classification, min_age, max_age, min_age_months, max_age_months } = query;
  const term = search || q;
  const where = ['1 = 1'];
  const params = [];
  const asOfDate = getManilaToday();

  if (term) {
    const searchTokens = String(term).trim().split(/\s+/).filter(Boolean);
    if (searchTokens.length > 0) {
      const searchClauses = searchTokens.map(() => `(
        r.first_name LIKE ? OR r.middle_name LIKE ? OR r.last_name LIKE ? OR r.suffix LIKE ? OR
        CONCAT_WS(' ', r.first_name, r.middle_name, r.last_name, r.suffix) LIKE ? OR
        CONCAT_WS(' ', r.last_name, r.first_name, r.middle_name, r.suffix) LIKE ? OR
        r.household_no LIKE ? OR r.contact_no LIKE ? OR r.philhealth_id_no LIKE ?
      )`);
      where.push(`(${searchClauses.join(' AND ')})`);
      searchTokens.forEach((token) => {
        const like = `%${token}%`;
        params.push(like, like, like, like, like, like, like, like, like);
      });
    }
  }

  if (min_age !== undefined && min_age !== '') {
    where.push('TIMESTAMPDIFF(YEAR, r.birthdate, ?) >= ?');
    params.push(asOfDate, Number(min_age));
  }

  if (max_age !== undefined && max_age !== '') {
    where.push('TIMESTAMPDIFF(YEAR, r.birthdate, ?) <= ?');
    params.push(asOfDate, Number(max_age));
  }

  if (min_age_months !== undefined && min_age_months !== '') {
    where.push('TIMESTAMPDIFF(MONTH, r.birthdate, ?) >= ?');
    params.push(asOfDate, Number(min_age_months));
  }

  if (max_age_months !== undefined && max_age_months !== '') {
    where.push('TIMESTAMPDIFF(MONTH, r.birthdate, ?) <= ?');
    params.push(asOfDate, Number(max_age_months));
  }

  if (SEXES.has(String(sex).toLowerCase())) {
    where.push('r.sex = ?');
    params.push(String(sex).toLowerCase());
  }
  if (RESIDENT_STATUSES.has(status)) {
    where.push('r.resident_status = ?');
    params.push(status);
  }
  if (sitio) {
    where.push('r.sitio = ?');
    params.push(String(sitio));
  }
  const classificationWhere = getClassificationWhere(classification);
  if (classificationWhere) {
    where.push(classificationWhere);
    if (classification === 'Senior Citizen') params.push(asOfDate);
  }
  return { sql: `WHERE ${where.join(' AND ')}`, params };
}

function applySort(sort, order) {
  const selected = SORTS[sort] ? sort : 'name';
  const descending = order === 'desc';
  const expressions = {
    name: `r.last_name ${descending ? 'DESC' : 'ASC'}, r.first_name ${descending ? 'DESC' : 'ASC'}`,
    age: `r.birthdate ${descending ? 'ASC' : 'DESC'}, r.last_name ASC, r.first_name ASC`,
    newest: `r.created_at ${descending ? 'ASC' : 'DESC'}, r.resident_id ${descending ? 'ASC' : 'DESC'}`,
    oldest: `r.created_at ${descending ? 'DESC' : 'ASC'}, r.resident_id ${descending ? 'DESC' : 'ASC'}`,
    sitio: `r.sitio ${descending ? 'DESC' : 'ASC'}, r.last_name ASC, r.first_name ASC`,
    status: `r.resident_status ${descending ? 'DESC' : 'ASC'}, r.last_name ASC, r.first_name ASC`
  };
  return expressions[selected];
}

function addDerivedFields(row) {
  const age = calculateAge(row.birthdate, new Date(`${getManilaToday()}T00:00:00`));
  return { ...row, age, senior_citizen: age !== null && age >= 60, category_flags: parseCategoryFlags(row.category_flags) };
}

const listResidents = async (req, res) => {
  try {
    await ensureResidentSchema();
    const page = normalizePage(req.query.page, 1);
    const requestedPageSize = req.query.pageSize ?? req.query.limit;
    const limit = Math.min(normalizePage(requestedPageSize, 10), 100);
    const { sql: where, params } = buildWhere(req.query);
    const orderBy = applySort(req.query.sort, req.query.order);
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM residents r ${where}`, params);
    const total = Number(countRows[0]?.total || 0);
    const offset = (page - 1) * limit;
    const [rows] = await pool.query(`${RESIDENT_SELECT_SQL} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return res.json({ success: true, data: { items: rows.map(addDerivedFields), total, page, limit, pageSize: limit, pagination: { page, limit, pageSize: limit, total, totalPages: Math.ceil(total / limit) } } });
  } catch (error) {
    logger.error('listResidents error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getResident = async (req, res) => {
  try {
    await ensureResidentSchema();
    const [rows] = await pool.query(`${RESIDENT_SELECT_SQL} WHERE r.resident_id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Resident not found' });
    return res.json({ success: true, data: addDerivedFields(rows[0]) });
  } catch (error) {
    logger.error('getResident error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

function validateResidentInput(body, existing = null) {
  const birthdate = body.birthdate !== undefined ? body.birthdate : existing?.birthdate;
  const sex = body.sex !== undefined ? body.sex : existing?.sex;
  const civilStatus = body.civil_status !== undefined ? body.civil_status : (existing?.civil_status || 'Unknown');
  const residentStatus = body.resident_status !== undefined ? body.resident_status : (existing?.resident_status || 'Active');
  const firstName = String(body.first_name ?? existing?.first_name ?? '').trim();
  const lastName = String(body.last_name ?? existing?.last_name ?? '').trim();
  const contactNumber = String(body.contact_no ?? existing?.contact_no ?? '').trim();
  const errors = {};

  if (!firstName) errors.first_name = 'First name is required.';
  else if (firstName.length < 2 || firstName.length > 100) errors.first_name = 'First name must be between 2 and 100 characters.';
  if (!lastName) errors.last_name = 'Last name is required.';
  else if (lastName.length < 2 || lastName.length > 100) errors.last_name = 'Last name must be between 2 and 100 characters.';
  if (!birthdate || !isValidBirthdate(String(birthdate).slice(0, 10))) errors.birthdate = 'Enter a valid birthdate that is not in the future.';
  if (!SEXES.has(String(sex || '').toLowerCase())) errors.sex = 'Select a valid sex.';
  if (!CIVIL_STATUSES.has(civilStatus)) errors.civil_status = 'Select a valid civil status.';
  if (!RESIDENT_STATUSES.has(residentStatus)) errors.resident_status = 'Select a valid resident status.';
  if (contactNumber) {
    const normalizedNumber = contactNumber.replace(/[\s()-]/g, '');
    if (!/^(?:09\d{9}|\+639\d{9})$/.test(normalizedNumber)) errors.contact_no = 'Enter a valid Philippine mobile number, such as 0917 123 4567.';
  }
  if (body.sitio && !SITIOS.includes(String(body.sitio).trim())) errors.sitio = 'Select a valid sitio.';

  return Object.keys(errors).length ? errors : null;
}

async function findDuplicatePhilHealthId(value, residentId = null) {
  const identifier = String(value || '').trim();
  if (!identifier) return false;
  const [rows] = await pool.query(
    `SELECT resident_id FROM residents
     WHERE LOWER(TRIM(philhealth_id_no)) = LOWER(?)
       AND (? IS NULL OR resident_id <> ?)
     LIMIT 1`,
    [identifier, residentId, residentId]
  );
  return rows.length > 0;
}

async function resolveResidentAddress(body, existing) {
  const keys = ['region_code', 'province_code', 'city_municipality_code', 'barangay_code'];
  const submitted = Object.fromEntries(keys.map((key) => [key, body[key] ? String(body[key]) : '']));
  const selectedCodes = Object.values(submitted);
  if (!selectedCodes.some(Boolean)) {
    return {
      ...Object.fromEntries(keys.map((key) => [key, existing?.[key] || null])),
      address: body.address !== undefined ? body.address || null : existing?.address || null
    };
  }

  if (selectedCodes.some((code) => !code)) {
    throw new Error('Select a region, province, city or municipality, and barangay.');
  }

  const matchesExisting = existing && keys.every((key) => submitted[key] === String(existing[key] || ''));
  if (matchesExisting) {
    return {
      ...Object.fromEntries(keys.map((key) => [key, existing[key]])),
      address: existing.address
    };
  }

  return resolveResidentLocation(submitted);
}

function residentValues(body, existing, userId, location) {
  const existingFlags = parseCategoryFlags(existing?.category_flags);
  const categories = existingFlags.filter((item) => !['Senior', 'Senior Citizen', 'Pregnant', 'Lactating', 'PWD'].includes(item));
  if (normalizeBoolean(body.pwd, existingFlags.includes('PWD'))) categories.push('PWD');
  return [
    body.first_name ?? existing?.first_name,
    body.middle_name !== undefined ? body.middle_name || null : existing?.middle_name,
    body.last_name ?? existing?.last_name,
    body.suffix !== undefined ? body.suffix || null : existing?.suffix,
    body.household_no !== undefined ? body.household_no || null : existing?.household_no,
    location.address,
    location.region_code,
    location.province_code,
    location.city_municipality_code,
    location.barangay_code,
    body.contact_no !== undefined ? body.contact_no || null : existing?.contact_no,
    body.philhealth_id_no !== undefined ? body.philhealth_id_no || null : existing?.philhealth_id_no,
    normalizeBoolean(body.is_4ps, existing?.is_4ps || 0),
    categories.length ? JSON.stringify(categories) : null,
    body.sitio !== undefined ? String(body.sitio).trim() || null : existing?.sitio,
    body.birthdate ?? existing?.birthdate,
    body.sex !== undefined ? String(body.sex).toLowerCase() : existing?.sex,
    body.civil_status !== undefined ? body.civil_status : (existing?.civil_status || 'Unknown'),
    body.occupation !== undefined ? body.occupation || null : existing?.occupation,
    body.resident_status !== undefined ? body.resident_status : (existing?.resident_status || 'Active'),
    normalizeBoolean(body.pregnant, existing?.pregnant || 0),
    normalizeBoolean(body.lactating, existing?.lactating || 0),
    body.profile_photo !== undefined ? (body.profile_photo || null) : (existing?.profile_photo || null),
    userId || null
  ];
}

const createResident = async (req, res) => {
  try {
    await ensureResidentSchema();
    const errors = validateResidentInput(req.body);
    if (errors) return res.status(400).json({ success: false, message: Object.values(errors)[0], errors });
    if (await findDuplicatePhilHealthId(req.body.philhealth_id_no)) {
      const duplicateErrors = { philhealth_id_no: 'A resident with this PhilHealth ID already exists.' };
      return res.status(409).json({ success: false, message: duplicateErrors.philhealth_id_no, errors: duplicateErrors });
    }
    let location;
    try {
      location = await resolveResidentAddress(req.body);
    } catch (locationError) {
      return res.status(400).json({ success: false, message: locationError.message });
    }
    const [result] = await pool.query(`
      INSERT INTO residents (first_name, middle_name, last_name, suffix, household_no, address, region_code, province_code,
        city_municipality_code, barangay_code, contact_no, philhealth_id_no, is_4ps, category_flags, sitio, birthdate, sex,
        civil_status, occupation, resident_status, pregnant, lactating, profile_photo, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, residentValues(req.body, null, req.user?.user_id, location));
    await writeAudit({ user_id: req.user?.user_id, action: 'CREATE', module: 'residents', table_name: 'residents', record_id: result.insertId, new_data: { ...req.body, senior_citizen: calculateAge(req.body.birthdate) >= 60 } });
    const [rows] = await pool.query(`${RESIDENT_SELECT_SQL} WHERE r.resident_id = ?`, [result.insertId]);
    return res.status(201).json({ success: true, data: addDerivedFields(rows[0]) });
  } catch (error) {
    logger.error('createResident error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const updateResident = async (req, res) => {
  try {
    await ensureResidentSchema();
    const [existingRows] = await pool.query('SELECT * FROM residents WHERE resident_id = ?', [req.params.id]);
    if (!existingRows.length) return res.status(404).json({ success: false, message: 'Resident not found' });
    const existing = existingRows[0];
    const errors = validateResidentInput(req.body, existing);
    if (errors) return res.status(400).json({ success: false, message: Object.values(errors)[0], errors });
    if (await findDuplicatePhilHealthId(req.body.philhealth_id_no ?? existing.philhealth_id_no, req.params.id)) {
      const duplicateErrors = { philhealth_id_no: 'A resident with this PhilHealth ID already exists.' };
      return res.status(409).json({ success: false, message: duplicateErrors.philhealth_id_no, errors: duplicateErrors });
    }
    let location;
    try {
      location = await resolveResidentAddress(req.body, existing);
    } catch (locationError) {
      return res.status(400).json({ success: false, message: locationError.message });
    }
    await pool.query(`
      UPDATE residents SET first_name = ?, middle_name = ?, last_name = ?, suffix = ?, household_no = ?, address = ?,
        region_code = ?, province_code = ?, city_municipality_code = ?, barangay_code = ?, contact_no = ?,
        philhealth_id_no = ?, is_4ps = ?, category_flags = ?, sitio = ?, birthdate = ?, sex = ?, civil_status = ?,
        occupation = ?, resident_status = ?, pregnant = ?, lactating = ?, profile_photo = ?, created_by = COALESCE(?, created_by)
      WHERE resident_id = ?
    `, [...residentValues(req.body, existing, req.user?.user_id, location), req.params.id]);
    await writeAudit({ user_id: req.user?.user_id, action: 'UPDATE', module: 'residents', table_name: 'residents', record_id: req.params.id, old_data: existing, new_data: req.body });
    const [rows] = await pool.query(`${RESIDENT_SELECT_SQL} WHERE r.resident_id = ?`, [req.params.id]);
    return res.json({ success: true, data: addDerivedFields(rows[0]) });
  } catch (error) {
    logger.error('updateResident error', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const deleteResident = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const userId = req.user?.user_id;
    const [residentRows] = await connection.query('SELECT * FROM residents WHERE resident_id = ?', [id]);
    if (!residentRows.length) return res.status(404).json({ success: false, message: 'Resident not found' });

    const resident = residentRows[0];
    const dependentTables = [
      ['health_records', 'health_record_id'],
      ['child_health_records', 'id'],
      ['operation_timbang', 'timbang_id'],
      ['adolescent_bmi_records', 'record_id'],
      ['adult_bmi_records', 'bmi_id'],
      ['senior_citizen_records', 'senior_id']
    ];
    const dependentCounts = {};

    await connection.beginTransaction();
    for (const [table] of dependentTables) {
      const [countRows] = await connection.query(`SELECT COUNT(*) AS count FROM ${table} WHERE resident_id = ?`, [id]);
      dependentCounts[table] = Number(countRows[0]?.count || 0);
    }
    await connection.query(
      'DELETE ota FROM operation_timbang_assessments ota JOIN operation_timbang ot ON ot.timbang_id = ota.timbang_id WHERE ot.resident_id = ?',
      [id]
    );
    for (const [table] of dependentTables) {
      await connection.query(`DELETE FROM ${table} WHERE resident_id = ?`, [id]);
    }
    await connection.query('DELETE FROM residents WHERE resident_id = ?', [id]);
    await connection.commit();

    await writeAudit({
      user_id: userId,
      action: 'DELETE',
      module: 'residents',
      table_name: 'residents',
      record_id: id,
      old_data: { resident, dependentCounts }
    });
    return res.json({ success: true, message: 'Resident and related records deleted' });
  } catch (error) {
    await connection.rollback();
    logger.error('deleteResident error', error);
    return res.status(500).json({ success: false, message: 'Unable to delete resident and related records' });
  } finally {
    connection.release();
  }
};

module.exports = { listResidents, getResident, createResident, updateResident, deleteResident };
