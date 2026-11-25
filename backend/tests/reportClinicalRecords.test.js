const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
const controllerPath = require.resolve('../src/controllers/reportController');

function loadReportController(pool) {
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === controllerPath) {
      if (request === '../config/database') return pool;
      if (request === '../services/logger') return { error: () => {} };
      if (request === '../services/manilaDateService') return { getManilaToday: () => '2026-11-25' };
      if (request === '../services/auditService') return { writeAudit: async () => {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  try {
    return require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
}

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

const recordTables = [
  'health_records',
  'patient_clinical_records',
  'child_health_records',
  'child_records',
  'maternal_records',
  'immunization_records',
];

test('FHSIS clinical record total includes every clinical, child, maternal, and immunization table', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('AS clinicalRecords')) return [[{ clinicalRecords: 18 }]];
      if (sql.includes('AS totalResidents')) return [[{}]];
      return [[]];
    },
  };
  const { getFhsisReport } = loadReportController(pool);
  const response = createResponse();

  await getFhsisReport({
    query: { period: 'custom', from: '2026-11-01', to: '2026-11-25' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.summary.clinicalRecords, 18);
  const totalQuery = queries.find(({ sql }) => sql.includes('AS clinicalRecords'));
  for (const table of recordTables) assert.match(totalQuery.sql, new RegExp(`FROM ${table}`));
  assert.deepEqual(totalQuery.params, ['2026-11-01', '2026-11-25']);
});

test('clinical record drilldown uses the same combined record sources', async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('COUNT(*) AS total')) return [[{ total: 18 }]];
      return [[{
        drilldown_id: 1,
        resident_id: 7,
        name: 'Report Resident',
        age: 30,
        sex: 'female',
        sitio: 'Capitol',
        relevant_date: '2026-11-12',
      }]];
    },
  };
  const { getFhsisDrilldown } = loadReportController(pool);
  const response = createResponse();

  await getFhsisDrilldown({
    query: {
      indicator: 'clinical-records',
      sex: 'total',
      from: '2026-11-01',
      to: '2026-11-25',
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.total, 18);
  const sourceQueries = queries.filter(({ sql }) => sql.includes('FROM ('));
  assert.equal(sourceQueries.length, 2);
  for (const { sql } of sourceQueries) {
    for (const table of recordTables) assert.match(sql, new RegExp(`FROM ${table}`));
  }
});
