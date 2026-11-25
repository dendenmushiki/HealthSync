const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/database');
const { listAllResidentMedicalRecords } = require('../src/controllers/residentMedicalRecordController');

test('paginates bulk medical records with a capped limit and parses record data', async () => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === 'SHOW COLUMNS FROM maternal_records') return [[{ Field: 'edc' }]];
    if (sql.startsWith('SELECT COUNT(*)')) return [[{ total: 101 }]];
    return [[{
      id: 8,
      resident_id: 21,
      record_type: 'clinical',
      record_data: '{"assessment":"cached"}',
    }]];
  };
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

  try {
    await listAllResidentMedicalRecords({ query: { page: '2', limit: '500' } }, response);
  } finally {
    pool.query = originalQuery;
  }

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data.items[0].record_data, { assessment: 'cached' });
  assert.deepEqual(response.body.data.pagination, { page: 2, limit: 100, total: 101, totalPages: 2 });
  assert.deepEqual(calls[2].params, [100, 100]);
  assert.match(calls[2].sql, /UNION ALL/);
});
