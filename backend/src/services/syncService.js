const pool = require('../config/database');
const { writeAudit } = require('./auditService');
const policyConstraints = require('../config/syncConstraints');
const logger = require('./logger');
const { ensureResidentSchema } = require('./residentSchemaService');
const { resolveResidentLocation } = require('./psgcService');
const { validateClinicalRecord } = require('./clinicalRecordValidation');
const { validateMaternalRecord } = require('./maternalRecordValidation');

class ValidationError extends Error {
  constructor(errors) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.errors = Array.isArray(errors) ? errors : [{ message: String(errors) }];
  }
}

// Whitelist of tables allowed to be synced by clients. Add table names here as needed.
const ALLOWED_TABLES = new Set([
  'residents',
  'health_records',
  'child_health_records',
  'operation_timbang',
  'operation_timbang_assessments',
  'adolescent_bmi_records',
  'adult_bmi_records',
  'senior_citizen_records',
  'patient_clinical_records',
  'child_records',
  'maternal_records',
  'immunization_records'
]);

function validateTableName(table) {
  if (!table || typeof table !== 'string') return false;
  // simple sanity check: lowercase alphanum and underscores only
  return /^[a-z0-9_]+$/.test(table) && ALLOWED_TABLES.has(table);
}

// Per-table allowed columns to prevent arbitrary column injection.
const ALLOWED_COLUMNS = {
  residents: new Set(['resident_id', 'first_name', 'middle_name', 'last_name', 'suffix', 'household_no', 'address', 'region_code', 'province_code', 'city_municipality_code', 'barangay_code', 'contact_no', 'philhealth_id_no', 'is_4ps', 'category_flags', 'sitio', 'created_by', 'birthdate', 'sex', 'civil_status', 'occupation', 'resident_status', 'pregnant', 'lactating', 'created_at', 'updated_at']),
  health_records: new Set(['health_record_id', 'resident_id', 'record_date', 'record_type', 'chief_complaint', 'history_of_present_illness', 'past_medical_history', 'allergies', 'family_medical_history', 'personal_social_history', 'blood_pressure', 'heart_rate', 'respiratory_rate', 'temperature', 'weight_kg', 'height_cm', 'findings', 'assessment', 'plan', 'maintenance_medications', 'past_surgical_history', 'immunization_history', 'family_planning_history', 'menstrual_history', 'pregnancy_history', 'remarks', 'medical_history', 'notes', 'recorded_by', 'created_at', 'updated_at']),
  child_health_records: new Set(['id', 'resident_id', 'family_serial_number', 'nhts_number', 'philhealth_number', 'philhealth_category', 'religion', 'birthplace', 'birth_weight_kg', 'school_name', 'grade_level', 'parent_guardian_name', 'parent_guardian_relationship', 'record_date', 'history_of_present_illness', 'past_medical_history', 'hospitalization_history', 'medication_allergies', 'food_allergies', 'family_medical_history', 'birth_history', 'immunization_history', 'blood_pressure', 'heart_rate', 'respiratory_rate', 'temperature', 'weight_kg', 'height_cm', 'findings', 'assessment', 'plan', 'remarks', 'recorded_by', 'created_at', 'updated_at']),
  operation_timbang: new Set(['operation_timbang_id', 'resident_id', 'timbang_date', 'weight', 'height', 'notes', 'created_at', 'updated_at']),
  operation_timbang_assessments: new Set(['assessment_id', 'operation_timbang_id', 'assessment_data', 'created_at']),
  adolescent_bmi_records: new Set(['record_id', 'resident_id', 'age_months', 'bmi', 'zscore', 'created_at']),
  adult_bmi_records: new Set(['record_id', 'resident_id', 'bmi', 'category', 'created_at']),
  senior_citizen_records: new Set(['record_id', 'resident_id', 'notes', 'created_at']),
  patient_clinical_records: new Set(['id', 'resident_id', 'record_data', 'recorded_by', 'created_at', 'updated_at']),
  child_records: new Set(['id', 'resident_id', 'record_data', 'recorded_by', 'created_at', 'updated_at']),
  maternal_records: new Set(['id', 'resident_id', 'record_data', 'edc', 'recorded_by', 'created_at', 'updated_at']),
  immunization_records: new Set(['id', 'resident_id', 'record_data', 'recorded_by', 'created_at', 'updated_at'])
};

const REQUIRED_FIELDS = {
  residents: ['first_name', 'last_name'],
  health_records: ['resident_id', 'record_date']
};

// Per-column types to validate and normalize incoming payload values.
// Types: 'string', 'int', 'float', 'date', 'datetime', 'json'
const ALLOWED_COLUMN_TYPES = {
  residents: {
    resident_id: 'int',
    first_name: 'string',
    middle_name: 'string',
    last_name: 'string',
    suffix: 'string',
    household_no: 'string',
    address: 'string',
    region_code: 'string',
    province_code: 'string',
    city_municipality_code: 'string',
    barangay_code: 'string',
    contact_no: 'string',
    philhealth_id_no: 'string',
    is_4ps: 'int',
    category_flags: 'json',
    sitio: 'string',
    created_by: 'int',
    birthdate: 'date',
    sex: 'string',
    civil_status: 'string',
    occupation: 'string',
    resident_status: 'string',
    pregnant: 'int',
    lactating: 'int'
  },
  health_records: {
    health_record_id: 'int',
    resident_id: 'int',
    record_date: 'date',
    record_type: 'string',
    chief_complaint: 'string',
    history_of_present_illness: 'string',
    past_medical_history: 'string',
    allergies: 'string',
    family_medical_history: 'string',
    personal_social_history: 'string',
    blood_pressure: 'string',
    heart_rate: 'string',
    respiratory_rate: 'string',
    temperature: 'float',
    weight_kg: 'float',
    height_cm: 'float',
    findings: 'string',
    assessment: 'string',
    plan: 'string',
    maintenance_medications: 'string',
    past_surgical_history: 'string',
    immunization_history: 'string',
    family_planning_history: 'string',
    menstrual_history: 'string',
    pregnancy_history: 'string',
    remarks: 'string',
    medical_history: 'string',
    notes: 'string',
    recorded_by: 'int'
  },
  child_health_records: {
    id: 'int',
    resident_id: 'int',
    family_serial_number: 'string',
    nhts_number: 'string',
    philhealth_number: 'string',
    philhealth_category: 'string',
    religion: 'string',
    birthplace: 'string',
    birth_weight_kg: 'float',
    school_name: 'string',
    grade_level: 'string',
    parent_guardian_name: 'string',
    parent_guardian_relationship: 'string',
    record_date: 'date',
    history_of_present_illness: 'string',
    past_medical_history: 'string',
    hospitalization_history: 'string',
    medication_allergies: 'string',
    food_allergies: 'string',
    family_medical_history: 'string',
    birth_history: 'string',
    immunization_history: 'string',
    blood_pressure: 'string',
    heart_rate: 'string',
    respiratory_rate: 'string',
    temperature: 'float',
    weight_kg: 'float',
    height_cm: 'float',
    findings: 'string',
    assessment: 'string',
    plan: 'string',
    remarks: 'string',
    recorded_by: 'int'
  },
  operation_timbang: {
    operation_timbang_id: 'int',
    resident_id: 'int',
    timbang_date: 'date',
    weight: 'float',
    height: 'float',
    notes: 'string'
  },
  operation_timbang_assessments: {
    assessment_id: 'int',
    operation_timbang_id: 'int',
    assessment_data: 'json'
  },
  adolescent_bmi_records: {
    record_id: 'int',
    resident_id: 'int',
    age_months: 'int',
    bmi: 'float',
    zscore: 'float'
  },
  adult_bmi_records: {
    record_id: 'int',
    resident_id: 'int',
    bmi: 'float',
    category: 'string'
  },
  senior_citizen_records: {
    record_id: 'int',
    resident_id: 'int',
    notes: 'string'
  },
  patient_clinical_records: { id: 'int', resident_id: 'int', record_data: 'json', recorded_by: 'int' },
  child_records: { id: 'int', resident_id: 'int', record_data: 'json', recorded_by: 'int' },
  maternal_records: { id: 'int', resident_id: 'int', record_data: 'json', edc: 'date', recorded_by: 'int' },
  immunization_records: { id: 'int', resident_id: 'int', record_data: 'json', recorded_by: 'int' }
};

// Cache for primary key column names per table
const PRIMARY_KEY_CACHE = {};

// metadata about table columns (nullable/defaults)
const TABLE_COLUMN_META = {};

async function getPrimaryKeyColumn(table, schemaName = process.env.DB_NAME) {
  if (PRIMARY_KEY_CACHE[table]) return PRIMARY_KEY_CACHE[table];
  try {
    const sql = `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_KEY = 'PRI' LIMIT 1`;
    const [rows] = await pool.query(sql, [schemaName, table]);
    const pk = rows && rows.length ? rows[0].COLUMN_NAME : null;
    PRIMARY_KEY_CACHE[table] = pk;
    return pk;
  } catch (err) {
    logger.error('Failed to lookup primary key for table', { table, err });
    return null;
  }
}

// Per-column constraints (ranges, enums, regex). Numeric constraints use `min`/`max`.
// Date constraints use `minDate`/`maxDate` in YYYY-MM-DD format. Enum constraints use `allowed` array.
const ALLOWED_COLUMN_CONSTRAINTS = {
  residents: {
    // birthdate should not be in the future
    birthdate: { minDate: '1900-01-01' },
    sitio: { allowed: require('../config/sitios') }
  },
  operation_timbang: {
    weight: { min: 0.5, max: 500 },
    height: { min: 20, max: 300 }
  },
  adolescent_bmi_records: {
    age_months: { min: 0, max: 240 },
    bmi: { min: 5, max: 60 },
    zscore: { min: -10, max: 10 }
  },
  adult_bmi_records: {
    bmi: { min: 5, max: 80 }
  },
  health_records: {
    record_date: { minDate: '1900-01-01' }
  },
  child_health_records: {
    record_date: { minDate: '1900-01-01' }
  }
};

function validateConstraints(table, payload) {
  const constraints = ALLOWED_COLUMN_CONSTRAINTS[table];
  if (!constraints) return;
  for (const [col, rule] of Object.entries(constraints)) {
    if (!(col in payload)) continue; // only validate provided fields
    const val = payload[col];
    if (val === null || val === undefined) continue;
    if ('min' in rule || 'max' in rule) {
      const n = Number(val);
      if (!Number.isFinite(n)) throw new ValidationError([{ field: col, message: `Column ${col} must be a number` }]);
      if ('min' in rule && n < rule.min) throw new ValidationError([{ field: col, message: `Column ${col} below minimum ${rule.min}` }]);
      if ('max' in rule && n > rule.max) throw new ValidationError([{ field: col, message: `Column ${col} above maximum ${rule.max}` }]);
    }
    if ('minDate' in rule || 'maxDate' in rule) {
      const text = String(val).slice(0, 10);
      const match = /^\d{4}-\d{2}-\d{2}$/.exec(text);
      if (!match) throw new ValidationError([{ field: col, message: `Column ${col} must be a valid date` }]);
      const [year, month, day] = text.split('-').map(Number);
      const calendarDate = new Date(Date.UTC(year, month - 1, day));
      if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
        throw new ValidationError([{ field: col, message: `Column ${col} must be a valid date` }]);
      }
      const asISO = text;
      if ('minDate' in rule && asISO < rule.minDate) throw new ValidationError([{ field: col, message: `Column ${col} date before ${rule.minDate}` }]);
      const todayParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      const todayValues = Object.fromEntries(todayParts.map((part) => [part.type, part.value]));
      const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
      if ('maxDate' in rule && asISO > rule.maxDate) throw new ValidationError([{ field: col, message: `Column ${col} date after ${rule.maxDate}` }]);
      if (!('maxDate' in rule) && asISO > today) throw new ValidationError([{ field: col, message: `Column ${col} cannot be in the future` }]);
    }
    if ('allowed' in rule) {
      if (!rule.allowed.includes(val)) throw new ValidationError([{ field: col, message: `Column ${col} value not allowed` }]);
    }
    if ('regex' in rule) {
      const re = new RegExp(rule.regex);
      if (!re.test(String(val))) throw new ValidationError([{ field: col, message: `Column ${col} does not match required format` }]);
    }
  }
}

function normalizeValue(type, value) {
  if (value === null || value === undefined) return null;
  if (type === 'string') return String(value);
  if (type === 'int') {
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      // allow numeric strings that represent integers
      const parsed = parseInt(value, 10);
      if (isNaN(parsed)) throw new ValidationError([{ field: null, message: `Expected integer but got ${value}` }]);
      return parsed;
    }
    return n;
  }
  if (type === 'float') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new ValidationError([{ field: null, message: `Expected number but got ${value}` }]);
    return n;
  }
  if (type === 'date') {
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new ValidationError([{ field: null, message: `Invalid date: ${value}` }]);
    return d.toISOString().split('T')[0];
  }
  if (type === 'datetime') {
    const d2 = new Date(value);
    if (isNaN(d2.getTime())) throw new ValidationError([{ field: null, message: `Invalid datetime: ${value}` }]);
    return d2.toISOString().replace('T', ' ').split('.')[0];
  }
  if (type === 'json') {
    if (typeof value === 'object') return JSON.stringify(value);
    try {
      // ensure valid JSON string
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed);
    } catch (e) {
      // fallback: wrap as string JSON
      return JSON.stringify(value);
    }
  }
  // default pass-through
  return value;
}

function normalizePayload(table, payload) {
  const types = ALLOWED_COLUMN_TYPES[table] || {};
  const out = {};
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) continue;
    const t = types[k] || 'string';
    out[k] = normalizeValue(t, payload[k]);
  }
  return out;
}

async function initializeFromDatabase(schemaName = process.env.DB_NAME) {
  try {
    if (!schemaName) {
      console.warn('No DB schema name provided for syncService initialization');
      return;
    }
    const tableNames = Array.from(ALLOWED_TABLES);
    if (!tableNames.length) return;
    const placeholders = tableNames.map(() => '?').join(',');
    const sql = `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})`;
    const params = [schemaName, ...tableNames];
    const [rows] = await pool.query(sql, params);
    // clear existing
    for (const k of Object.keys(ALLOWED_COLUMNS)) delete ALLOWED_COLUMNS[k];
    for (const k of Object.keys(ALLOWED_COLUMN_TYPES)) delete ALLOWED_COLUMN_TYPES[k];

    for (const row of rows) {
      const tname = row.TABLE_NAME;
      const col = row.COLUMN_NAME;
        const dtype = row.DATA_TYPE; // e.g., int, varchar, datetime, json
        const isNullable = row.IS_NULLABLE; // 'YES' or 'NO'
        const colDefault = row.COLUMN_DEFAULT; // may be null
      if (!ALLOWED_COLUMNS[tname]) ALLOWED_COLUMNS[tname] = new Set();
      ALLOWED_COLUMNS[tname].add(col);
      // map SQL type to normalized type
      let mapped = 'string';
      const dt = (dtype || '').toLowerCase();
      if (['int','bigint','smallint','mediumint','tinyint'].includes(dt)) mapped = 'int';
      else if (['decimal','float','double'].includes(dt)) mapped = 'float';
      else if (['date'].includes(dt)) mapped = 'date';
      else if (['datetime','timestamp'].includes(dt)) mapped = 'datetime';
      else if (['json'].includes(dt)) mapped = 'json';
      else mapped = 'string';
      if (!ALLOWED_COLUMN_TYPES[tname]) ALLOWED_COLUMN_TYPES[tname] = {};
      ALLOWED_COLUMN_TYPES[tname][col] = mapped;
      if (!TABLE_COLUMN_META[tname]) TABLE_COLUMN_META[tname] = {};
      TABLE_COLUMN_META[tname][col] = { isNullable: isNullable === 'YES', hasDefault: colDefault !== null };
    }
    // merge policy constraints into ALLOWED_COLUMN_CONSTRAINTS
    for (const [t, rules] of Object.entries(policyConstraints || {})) {
      if (!ALLOWED_COLUMN_CONSTRAINTS[t]) ALLOWED_COLUMN_CONSTRAINTS[t] = {};
      Object.assign(ALLOWED_COLUMN_CONSTRAINTS[t], rules);
    }
    logger.info('syncService: loaded schema info for tables', { tables: Object.keys(ALLOWED_COLUMNS) });
  } catch (err) {
    logger.error('Failed to initialize syncService from DB schema', err);
  }
}


function validatePayload(table, payload, operation) {
  if (!payload || typeof payload !== 'object') throw new ValidationError([{ field: null, message: 'Invalid payload' }]);
  const allowed = ALLOWED_COLUMNS[table];
  if (!allowed) throw new ValidationError([{ field: null, message: 'No column whitelist defined for table' }]);
  const keys = Object.keys(payload).filter(k => payload[k] !== undefined);
  // For CREATE ensure at least one field
  if (operation === 'CREATE' && keys.length === 0) throw new ValidationError([{ field: null, message: 'No fields provided for CREATE' }]);
  const invalid = keys.filter(k => !allowed.has(k));
  if (invalid.length) throw new ValidationError(invalid.map(f => ({ field: f, message: `Invalid field for ${table}` })));
  // check required fields if any
  const req = REQUIRED_FIELDS[table] || [];
  const missing = req.filter(r => !keys.includes(r) || payload[r] === null || payload[r] === '');
  if (operation === 'CREATE' && missing.length) throw new ValidationError(missing.map(f => ({ field: f, message: 'Missing required field' })));
}

async function ensureIdempotencyTable() {
  const sql = `CREATE TABLE IF NOT EXISTS sync_idempotency (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idempotency_key VARCHAR(100) NOT NULL UNIQUE,
    module_name VARCHAR(100),
    table_name VARCHAR(100),
    operation VARCHAR(20),
    server_record_id INT NULL,
    response JSON NULL,
    status VARCHAR(20) DEFAULT 'SUCCESS',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB;`;
  await pool.query(sql);
}

async function findIdempotency(key) {
  const [rows] = await pool.query('SELECT * FROM sync_idempotency WHERE idempotency_key = ?', [key]);
  return rows && rows.length ? rows[0] : null;
}

async function claimIdempotencyRecord({
  key,
  module_name,
  table_name,
  operation,
  ownerId,
  requestFingerprint,
  offlineSync = false,
  clientCreatedAt = null,
}) {
  const metadata = {
    ownerId: String(ownerId),
    requestFingerprint,
    outcome: 'PENDING',
    offlineSync: Boolean(offlineSync),
    ...(clientCreatedAt ? { clientCreatedAt } : {}),
  };
  try {
    await pool.query(
      'INSERT INTO sync_idempotency (idempotency_key, module_name, table_name, operation, response, status) VALUES (?, ?, ?, ?, ?, ?)',
      [key, module_name, table_name, operation, JSON.stringify(metadata), 'PENDING']
    );
    return null;
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
    return findIdempotency(key);
  }
}

async function markIdempotencyRejected({ key, ownerId, requestFingerprint }) {
  const metadata = JSON.stringify({
    ownerId: String(ownerId),
    requestFingerprint,
    outcome: 'REJECTED',
  });
  await pool.query(
    'UPDATE sync_idempotency SET response = ?, status = ? WHERE idempotency_key = ? AND status = ?',
    [metadata, 'FAILED', key, 'PENDING']
  );
}

async function saveIdempotency({
  key,
  module_name,
  table_name,
  operation,
  server_record_id = null,
  response = null,
  status = 'SUCCESS',
  ownerId = null,
  requestFingerprint = null,
  offlineSync = false,
  clientCreatedAt = null,
}) {
  const storedResponse = response && ownerId !== null && requestFingerprint
    ? JSON.stringify({
      ownerId: String(ownerId),
      requestFingerprint,
      outcome: 'SUCCESS',
      offlineSync: Boolean(offlineSync),
      ...(clientCreatedAt ? { clientCreatedAt } : {}),
      response,
    })
    : response ? JSON.stringify(response) : null;
  if (ownerId !== null && requestFingerprint) {
    const [result] = await pool.query(
      'UPDATE sync_idempotency SET server_record_id = ?, response = ?, status = ? WHERE idempotency_key = ? AND status = ?',
      [server_record_id, storedResponse, status, key, 'PENDING']
    );
    if (!result?.affectedRows) throw new Error('The idempotency claim could not be completed.');
    return;
  }
  const sql = `INSERT INTO sync_idempotency (idempotency_key, module_name, table_name, operation, server_record_id, response, status) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  await pool.query(sql, [key, module_name, table_name, operation, server_record_id, storedResponse, status]);
}

async function processOperation({
  idempotencyKey,
  operation,
  module,
  table,
  payload,
  userId,
  ip = null,
  userAgent = null,
  requestFingerprint = null,
  offlineSync = false,
  clientCreatedAt = null,
}) {
  // ensure idempotency table exists
  await ensureIdempotencyTable();

  // validate allowed table names to prevent arbitrary SQL usage
  if (!validateTableName(table)) {
    throw new Error('Table not allowed for sync or invalid table name');
  }

  if (table === 'residents') {
    await ensureResidentSchema();
    for (const column of ['region_code', 'province_code', 'city_municipality_code', 'barangay_code']) {
      ALLOWED_COLUMNS.residents.add(column);
      ALLOWED_COLUMN_TYPES.residents[column] = 'string';
    }
  }

  // check existing key
  const existing = await findIdempotency(idempotencyKey);
  if (existing) {
    return { fromCache: true, record: existing };
  }
  if (userId !== undefined && userId !== null && requestFingerprint) {
    const claimed = await claimIdempotencyRecord({
      key: idempotencyKey,
      module_name: module,
      table_name: table,
      operation,
      ownerId: userId,
      requestFingerprint,
      offlineSync,
      clientCreatedAt,
    });
    if (claimed) return { fromCache: true, record: claimed };
  }

  // validate payload fields and required fields
  validatePayload(table, payload, operation);
  // normalize types (throws on invalid types)
  const normalizedPayload = normalizePayload(table, payload || {});
  if (table === 'residents' && normalizedPayload.civil_status === 'Unknown') {
    normalizedPayload.civil_status = '';
  }
  // validate per-column constraints (ranges, enums, dates)
  validateConstraints(table, normalizedPayload);
  if (table === 'patient_clinical_records' && normalizedPayload.record_data) {
    const clinicalErrors = validateClinicalRecord(JSON.parse(normalizedPayload.record_data));
    if (Object.keys(clinicalErrors).length) {
      throw new ValidationError(Object.entries(clinicalErrors).map(([field, message]) => ({ field, message })));
    }
  }
  if (table === 'maternal_records' && normalizedPayload.record_data) {
    let maternalData;
    try {
      maternalData = JSON.parse(normalizedPayload.record_data);
    } catch (error) {
      throw new ValidationError([{ field: 'record_data', message: 'Maternal record data must be valid JSON.' }]);
    }
    const maternalErrors = validateMaternalRecord(maternalData);
    if (Object.keys(maternalErrors).length) {
      throw new ValidationError(Object.entries(maternalErrors).map(([field, message]) => ({ field, message })));
    }
    const edcValue = maternalData.edc ? String(maternalData.edc).slice(0, 10) : null;
    normalizedPayload.edc = edcValue;
    payload.edc = edcValue;
  }
  if (table === 'residents' && ['region_code', 'province_code', 'city_municipality_code', 'barangay_code'].some((field) => normalizedPayload[field])) {
    const location = await resolveResidentLocation(normalizedPayload);
    Object.assign(normalizedPayload, location);
  }

  // Basic router for supported modules/tables. Implement residents CREATE/UPDATE for now.
  if (table === 'residents') {
    if (operation === 'CREATE') {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const insertSql = `INSERT INTO residents (first_name, middle_name, last_name, suffix, household_no, address, region_code, province_code, city_municipality_code, barangay_code, contact_no, philhealth_id_no, is_4ps, category_flags, sitio, birthdate, sex, civil_status, occupation, resident_status, pregnant, lactating, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const [res] = await conn.query(insertSql, [
          normalizedPayload.first_name,
          normalizedPayload.middle_name || null,
          normalizedPayload.last_name,
          normalizedPayload.suffix || null,
          normalizedPayload.household_no || null,
          normalizedPayload.address || null,
          normalizedPayload.region_code || null,
          normalizedPayload.province_code || null,
          normalizedPayload.city_municipality_code || null,
          normalizedPayload.barangay_code || null,
          normalizedPayload.contact_no || null,
          normalizedPayload.philhealth_id_no || null,
          normalizedPayload.is_4ps !== undefined ? Number(normalizedPayload.is_4ps) : 0,
          normalizedPayload.category_flags ? JSON.stringify(normalizedPayload.category_flags) : null,
          normalizedPayload.sitio || null,
          normalizedPayload.birthdate || null,
          normalizedPayload.sex || null,
          normalizedPayload.civil_status || '',
          normalizedPayload.occupation || null,
          normalizedPayload.resident_status || 'Active',
          normalizedPayload.pregnant !== undefined ? Number(normalizedPayload.pregnant) : 0,
          normalizedPayload.lactating !== undefined ? Number(normalizedPayload.lactating) : 0,
          userId || null
        ]);
        const newId = res.insertId;
        await writeAudit({ user_id: userId, action: 'CREATE', module: module, table_name: table, record_id: newId, new_data: payload, ip_address: ip, user_agent: userAgent });
        await conn.commit();
        const response = { success: true, serverRecordId: newId };
        await saveIdempotency({
          key: idempotencyKey,
          module_name: module,
          table_name: table,
          operation,
          server_record_id: newId,
          response,
          ownerId: userId,
          requestFingerprint,
          offlineSync,
          clientCreatedAt,
        });
        return { fromCache: false, response };
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    } else if (operation === 'UPDATE') {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const id = normalizedPayload.resident_id || payload.resident_id;
        if (!id) throw new Error('resident_id required for UPDATE');
        const [existing] = await conn.query('SELECT * FROM residents WHERE resident_id = ?', [id]);
        if (!existing || existing.length === 0) throw new Error('Resident not found');
        const oldData = existing[0];
        const updateSql = `UPDATE residents SET first_name = ?, middle_name = ?, last_name = ?, suffix = ?, household_no = ?, address = ?, region_code = ?, province_code = ?, city_municipality_code = ?, barangay_code = ?, contact_no = ?, philhealth_id_no = ?, is_4ps = ?, category_flags = ?, sitio = ?, birthdate = ?, sex = ?, civil_status = ?, occupation = ?, resident_status = ?, pregnant = ?, lactating = ?, created_by = COALESCE(?, created_by) WHERE resident_id = ?`;
        await conn.query(updateSql, [
          normalizedPayload.first_name || oldData.first_name,
          normalizedPayload.middle_name || oldData.middle_name,
          normalizedPayload.last_name || oldData.last_name,
          normalizedPayload.suffix !== undefined ? normalizedPayload.suffix : oldData.suffix,
          normalizedPayload.household_no !== undefined ? normalizedPayload.household_no : oldData.household_no,
          normalizedPayload.address !== undefined ? normalizedPayload.address : oldData.address,
          normalizedPayload.region_code !== undefined ? normalizedPayload.region_code : oldData.region_code,
          normalizedPayload.province_code !== undefined ? normalizedPayload.province_code : oldData.province_code,
          normalizedPayload.city_municipality_code !== undefined ? normalizedPayload.city_municipality_code : oldData.city_municipality_code,
          normalizedPayload.barangay_code !== undefined ? normalizedPayload.barangay_code : oldData.barangay_code,
          normalizedPayload.contact_no !== undefined ? normalizedPayload.contact_no : oldData.contact_no,
          normalizedPayload.philhealth_id_no !== undefined ? normalizedPayload.philhealth_id_no : oldData.philhealth_id_no,
          normalizedPayload.is_4ps !== undefined ? Number(normalizedPayload.is_4ps) : oldData.is_4ps,
          normalizedPayload.category_flags !== undefined ? (normalizedPayload.category_flags ? JSON.stringify(normalizedPayload.category_flags) : null) : oldData.category_flags,
          normalizedPayload.sitio !== undefined ? normalizedPayload.sitio : oldData.sitio,
          normalizedPayload.birthdate !== undefined ? normalizedPayload.birthdate : oldData.birthdate,
          normalizedPayload.sex !== undefined ? normalizedPayload.sex : oldData.sex,
          normalizedPayload.civil_status !== undefined ? normalizedPayload.civil_status : oldData.civil_status,
          normalizedPayload.occupation !== undefined ? normalizedPayload.occupation : oldData.occupation,
          normalizedPayload.resident_status !== undefined ? normalizedPayload.resident_status : oldData.resident_status,
          normalizedPayload.pregnant !== undefined ? Number(normalizedPayload.pregnant) : oldData.pregnant,
          normalizedPayload.lactating !== undefined ? Number(normalizedPayload.lactating) : oldData.lactating,
          userId || null,
          id
        ]);
        await writeAudit({ user_id: userId, action: 'UPDATE', module: module, table_name: table, record_id: id, old_data: oldData, new_data: payload, ip_address: ip, user_agent: userAgent });
        await conn.commit();
        const response = { success: true, serverRecordId: id };
        await saveIdempotency({
          key: idempotencyKey,
          module_name: module,
          table_name: table,
          operation,
          server_record_id: id,
          response,
          ownerId: userId,
          requestFingerprint,
          offlineSync,
          clientCreatedAt,
        });
        return { fromCache: false, response };
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }
  }

  // Generic handler for other tables: dynamically build insert/update queries from payload
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Ensure metadata loaded for this table (lazy init for tests/one-off runs)
    if (!TABLE_COLUMN_META[table] || Object.keys(TABLE_COLUMN_META[table]).length === 0) {
      await initializeFromDatabase(process.env.DB_NAME);
    }
    let keys = Object.keys(payload || {}).filter(k => payload[k] !== undefined);
    const primaryKey = await getPrimaryKeyColumn(table);
    logger.info('processOperation keys', { table, keys, primaryKey });
    if (operation === 'CREATE') {
      // Ensure DB-required non-nullable columns without defaults are present
      const meta = TABLE_COLUMN_META[table] || {};
      // Explicitly auto-fill common user columns if present in table meta
      if (userId) {
        logger.info('autofill check', { table, userIdPresent: !!userId, hasRecordedBy: !!meta['recorded_by'], keysBefore: keys });
        if (meta['recorded_by'] && !keys.includes('recorded_by')) {
          logger.info('autofill recorded_by', { table });
          normalizedPayload['recorded_by'] = userId;
          payload['recorded_by'] = userId;
          keys.push('recorded_by');
        }
        if (meta['user_id'] && !keys.includes('user_id')) {
          normalizedPayload['user_id'] = userId;
          payload['user_id'] = userId;
          keys.push('user_id');
        }
      }
      const missingDbRequired = [];
      for (const [colName, colMeta] of Object.entries(meta)) {
        if (colMeta.isNullable || colMeta.hasDefault) continue;
        if (keys.includes(colName)) continue;
        // auto-fill any '*_by' or common user id columns with userId when available
        const userIdColumns = ['user_id', 'created_by', 'creator_id', 'created_by_user'];
        if ((colName.endsWith('_by') || userIdColumns.includes(colName)) && userId) {
          normalizedPayload[colName] = userId;
          payload[colName] = userId;
          keys.push(colName);
          continue;
        }
        // auto-fill timestamps/dates for columns that look like time markers when possible
        const colType = (ALLOWED_COLUMN_TYPES[table] && ALLOWED_COLUMN_TYPES[table][colName]) || null;
        if (colType === 'date' || colType === 'datetime') {
          // fill date/datetime fields ending with _at or containing 'date' with current time
          if (colName.endsWith('_at') || /date/.test(colName)) {
            if (colType === 'date') normalizedPayload[colName] = new Date().toISOString().split('T')[0];
            else normalizedPayload[colName] = new Date().toISOString().replace('T', ' ').split('.')[0];
            payload[colName] = normalizedPayload[colName];
            keys.push(colName);
            continue;
          }
        }
        missingDbRequired.push(colName);
      }
      if (missingDbRequired.length) {
        logger.info('missing DB-required columns', { table, missingDbRequired });
        throw new ValidationError(missingDbRequired.map(f => ({ field: f, message: 'Missing required DB column (no default)' })));
      }
      // exclude the table's primary key from insert if present (allow foreign keys like resident_id)
      const idKey = primaryKey && keys.includes(primaryKey) ? primaryKey : null;
      const insertKeys = keys.filter(k => k !== idKey);
      logger.info('generic CREATE keys', { table, idKey, insertKeys });
      if (insertKeys.length === 0) throw new Error('No valid fields provided for CREATE');
      const cols = insertKeys.map(k => `\`${k}\``).join(', ');
      const placeholders = insertKeys.map(() => '?').join(', ');
      // use normalized payload values
      const values = insertKeys.map(k => normalizedPayload[k]);
      const insertSql = `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`;
      logger.info('generic CREATE SQL', { table, sql: insertSql });
      const [r] = await conn.query(insertSql, values);
      const newId = r.insertId || null;
      await writeAudit({ user_id: userId, action: 'CREATE', module: module, table_name: table, record_id: newId, new_data: payload, ip_address: ip, user_agent: userAgent });
      await conn.commit();
      const response = { success: true, serverRecordId: newId };
      await saveIdempotency({
        key: idempotencyKey,
        module_name: module,
        table_name: table,
        operation,
        server_record_id: newId,
        response,
        ownerId: userId,
        requestFingerprint,
        offlineSync,
        clientCreatedAt,
      });
      return { fromCache: false, response };
    } else if (operation === 'UPDATE') {
      // find an id key in payload: prefer primary key, else fall back to any *_id
      const idKey = primaryKey && keys.includes(primaryKey) ? primaryKey : keys.find(k => k === 'id' || k.endsWith('_id'));
      if (!idKey) throw new Error('No id key found for UPDATE');
      const id = normalizedPayload[idKey] || payload[idKey];
      const setKeys = keys.filter(k => k !== idKey);
      if (setKeys.length === 0) throw new Error('No fields to update');
      const setClause = setKeys.map(k => `\`${k}\` = ?`).join(', ');
      const values = setKeys.map(k => normalizedPayload[k]);
      const updateSql = `UPDATE \`${table}\` SET ${setClause} WHERE \`${idKey}\` = ?`;
      values.push(id);
      logger.info('generic UPDATE SQL', { table, sql: updateSql });
      await conn.query(updateSql, values);
      await writeAudit({ user_id: userId, action: 'UPDATE', module: module, table_name: table, record_id: id, old_data: null, new_data: payload, ip_address: ip, user_agent: userAgent });
      await conn.commit();
      const response = { success: true, serverRecordId: id };
      await saveIdempotency({
        key: idempotencyKey,
        module_name: module,
        table_name: table,
        operation,
        server_record_id: id,
        response,
        ownerId: userId,
        requestFingerprint,
        offlineSync,
        clientCreatedAt,
      });
      return { fromCache: false, response };
    } else if (operation === 'DELETE' && ['patient_clinical_records', 'child_records', 'maternal_records', 'immunization_records'].includes(table)) {
      const id = normalizedPayload.id || payload.id;
      const residentId = normalizedPayload.resident_id || payload.resident_id;
      if (!id || !residentId) throw new Error('id and resident_id are required for DELETE');
      const [existing] = await conn.query(`SELECT * FROM \`${table}\` WHERE id = ? AND resident_id = ?`, [id, residentId]);
      if (!existing.length) throw new Error('Medical record not found');
      await conn.query(`DELETE FROM \`${table}\` WHERE id = ? AND resident_id = ?`, [id, residentId]);
      await writeAudit({ user_id: userId, action: 'DELETE', module, table_name: table, record_id: id, old_data: existing[0].record_data, ip_address: ip, user_agent: userAgent });
      await conn.commit();
      const response = { success: true, serverRecordId: id };
      await saveIdempotency({
        key: idempotencyKey,
        module_name: module,
        table_name: table,
        operation,
        server_record_id: id,
        response,
        ownerId: userId,
        requestFingerprint,
        offlineSync,
        clientCreatedAt,
      });
      return { fromCache: false, response };
    }
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // If reached here, unsupported
  throw new Error('Unsupported sync operation or table');
}

module.exports = {
  processOperation,
  ensureIdempotencyTable,
  findIdempotency,
  markIdempotencyRejected,
  initializeFromDatabase,
  getPrimaryKeyColumn,
  validateTableName,
};

// exported for debugging/tests
module.exports.getTableColumnMeta = function(table) {
  return TABLE_COLUMN_META[table] || null;
};
