const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/database');

const servicePath = require.resolve('../src/services/maternalRecordSchemaService');
const controllerPath = require.resolve('../src/controllers/residentMedicalRecordController');

test('adds the nullable maternal EDC column once when it is missing', async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql) => {
    calls.push(sql);
    if (sql === 'SHOW COLUMNS FROM maternal_records') return [[]];
    if (sql.startsWith('ALTER TABLE maternal_records')) return [[], []];
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  delete require.cache[servicePath];
  try {
    const { ensureMaternalRecordSchema } = require(servicePath);
    await Promise.all([
      ensureMaternalRecordSchema(),
      ensureMaternalRecordSchema(),
    ]);

    assert.deepEqual(calls, [
      'SHOW COLUMNS FROM maternal_records',
      'ALTER TABLE maternal_records ADD COLUMN IF NOT EXISTS edc DATE NULL AFTER record_data',
    ]);
  } finally {
    pool.query = originalQuery;
    delete require.cache[servicePath];
  }
});

test('does not alter maternal records when the EDC column already exists', async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql) => {
    calls.push(sql);
    if (sql === 'SHOW COLUMNS FROM maternal_records') return [[{ Field: 'edc' }]];
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  delete require.cache[servicePath];
  try {
    const { ensureMaternalRecordSchema } = require(servicePath);
    await ensureMaternalRecordSchema();
    assert.deepEqual(calls, ['SHOW COLUMNS FROM maternal_records']);
  } finally {
    pool.query = originalQuery;
    delete require.cache[servicePath];
  }
});

test('loads existing maternal records after repairing a missing EDC column', async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql) => {
    calls.push(sql);
    if (sql === 'SHOW COLUMNS FROM maternal_records') return [[]];
    if (sql.startsWith('ALTER TABLE maternal_records')) return [[], []];
    if (sql.startsWith('SELECT resident_id FROM residents')) return [[{ resident_id: 85 }]];
    if (sql.includes('FROM `maternal_records`')) {
      return [[{
        id: 2,
        resident_id: 85,
        record_data: '{"visit_date":"2026-11-10","edc":"2027-01-20"}',
        edc: '2027-01-20',
      }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  delete require.cache[servicePath];
  delete require.cache[controllerPath];
  try {
    const { listResidentMedicalRecords } = require(controllerPath);
    const response = {
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

    await listResidentMedicalRecords({
      params: { residentId: '85', recordType: 'maternal' },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data[0].id, 2);
    assert.equal(response.body.data[0].record_data.edc, '2027-01-20');
    assert.equal(calls[0], 'SHOW COLUMNS FROM maternal_records');
    assert.match(calls[1], /^ALTER TABLE maternal_records/);
  } finally {
    pool.query = originalQuery;
    delete require.cache[servicePath];
    delete require.cache[controllerPath];
  }
});
