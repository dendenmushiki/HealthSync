const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/database');
const {
  createResidentMedicalRecord,
  listAllResidentMedicalRecords,
  updateResidentMedicalRecord,
} = require('../src/controllers/residentMedicalRecordController');

function createResponse() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('creates and updates maternal EDC in both JSON data and the nullable date column', async () => {
  const recordData = { lmp: '2024-04-22', edc: '2025-01-27' };
  const createCalls = [];
  const connection = {
    async query(sql, params) {
      createCalls.push({ sql, params });
      if (sql.startsWith('SELECT resident_id FROM residents')) return [[{ resident_id: 7 }]];
      if (sql.startsWith('INSERT INTO `maternal_records`')) return [{ insertId: 20 }];
      if (sql.startsWith('SELECT id, resident_id, record_data, edc')) {
        return [[{ id: 20, resident_id: 7, record_data: JSON.stringify(recordData), edc: '2025-01-27' }]];
      }
      return [{ insertId: 1 }];
    },
  };
  const createResponseBody = createResponse();
  const originalSchemaQuery = pool.query;
  pool.query = async (sql) => {
    if (sql === 'SHOW COLUMNS FROM maternal_records') return [[{ Field: 'edc' }]];
    throw new Error(`Unexpected schema query: ${sql}`);
  };
  try {
    await createResidentMedicalRecord({
      params: { residentId: '7', recordType: 'maternal' },
      body: { record_data: recordData },
      user: { user_id: 3 },
      idempotencyConnection: connection,
    }, createResponseBody);
  } finally {
    pool.query = originalSchemaQuery;
  }

  assert.equal(createResponseBody.statusCode, 201);
  const insertCall = createCalls.find((call) => call.sql.startsWith('INSERT INTO `maternal_records`'));
  assert.match(insertCall.sql, /\(resident_id, record_data, edc, recorded_by\)/);
  assert.equal(insertCall.params[2], '2025-01-27');
  assert.deepEqual(createResponseBody.body.data.record_data, recordData);

  const originalQuery = pool.query;
  const updateCalls = [];
  pool.query = async (sql, params) => {
    updateCalls.push({ sql, params });
    if (sql.startsWith('SELECT * FROM `maternal_records`')) {
      return [[{ id: 20, resident_id: 7, record_data: JSON.stringify({ lmp: '2024-04-22' }) }]];
    }
    if (sql.startsWith('SELECT id, resident_id, record_data, edc')) {
      return [[{ id: 20, resident_id: 7, record_data: JSON.stringify(recordData), edc: '2025-01-27' }]];
    }
    return [{ affectedRows: 1 }];
  };
  try {
    const updateResponseBody = createResponse();
    await updateResidentMedicalRecord({
      params: { residentId: '7', recordId: '20', recordType: 'maternal' },
      body: { record_data: recordData },
      user: { user_id: 3 },
    }, updateResponseBody);
    const updateCall = updateCalls.find((call) => call.sql.startsWith('UPDATE `maternal_records`'));
    assert.match(updateCall.sql, /record_data = \?, edc = \?/);
    assert.equal(updateCall.params[1], '2025-01-27');
    assert.deepEqual(updateResponseBody.body.data.record_data, recordData);
  } finally {
    pool.query = originalQuery;
  }
});

test('loads a maternal EDC from the nullable column for older JSON records', async () => {
  const originalQuery = pool.query;
  pool.query = async (sql) => {
    if (sql.startsWith('SELECT COUNT(*)')) return [[{ total: 1 }]];
    return [[{
      id: 20,
      resident_id: 7,
      record_type: 'maternal',
      record_data: '{"lmp":"2024-04-22"}',
      edc: '2025-01-27',
    }]];
  };
  try {
    const response = createResponse();
    await listAllResidentMedicalRecords({ query: {} }, response);
    assert.equal(response.body.data.items[0].record_data.edc, '2025-01-27');
  } finally {
    pool.query = originalQuery;
  }
});

test('rejects EDC before LMP without writing a record', async () => {
  let queries = 0;
  const connection = { async query() { queries += 1; return [[], []]; } };
  const response = createResponse();
  await createResidentMedicalRecord({
    params: { residentId: '7', recordType: 'maternal' },
    body: { record_data: { lmp: '2024-10-21', edc: '2024-01-15' } },
    user: { user_id: 3 },
    idempotencyConnection: connection,
  }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(queries, 0);
});
