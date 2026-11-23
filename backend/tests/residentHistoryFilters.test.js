const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;

function loadController(controllerFile, mocks) {
  const modulePath = `../src/controllers/${controllerFile}`;
  const resolvedPath = require.resolve(modulePath);
  delete require.cache[resolvedPath];
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename?.endsWith(`\\controllers\\${controllerFile}`) &&
        Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function responseStub() {
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

test('health record overview applies the resident filter to counts and page queries', async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('SELECT COUNT(*) AS total FROM')) return [[{ total: 1 }]];
      if (sql.includes('SELECT record_type, COUNT(*) AS total')) return [[{ record_type: 'clinical', total: 1 }]];
      if (sql.includes('SELECT COUNT(*) AS totalRecords')) {
        return [[{ totalRecords: 1, residentsWithRecords: 1, addedThisMonth: 0, addedThisWeek: 0, availableTypes: 'clinical' }]];
      }
      if (sql.includes('SELECT * FROM')) return [[{ record_id: 4, resident_id: 15, record_type: 'clinical' }]];
      throw new Error(`Unexpected SQL in health record filter test: ${sql}`);
    },
  };
  const { listAllHealthRecords } = loadController('healthRecordController.js', {
    '../config/database': pool,
    '../services/auditService': { writeAudit: async () => {} },
    '../services/logger': { error: () => {} },
  });
  const response = responseStub();

  await listAllHealthRecords({ query: { resident_id: '15' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.items[0].resident_id, 15);
  for (const query of queries.slice(0, 3)) {
    assert.match(query.sql, /resident_id = \?/);
    assert.equal(query.values.filter((value) => value === 15).length, 2);
  }
});

test('health record overview rejects an invalid resident filter before querying', async () => {
  let queryCount = 0;
  const { listAllHealthRecords } = loadController('healthRecordController.js', {
    '../config/database': { query: async () => { queryCount += 1; return [[]]; } },
    '../services/auditService': { writeAudit: async () => {} },
    '../services/logger': { error: () => {} },
  });
  const response = responseStub();

  await listAllHealthRecords({ query: { resident_id: '0' } }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(queryCount, 0);
});

test('nutrition record list filters assessment rows to one resident', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('FROM adult_bmi_records')) {
        return [[
          { id: 81, resident_id: 15, record_type: 'Adult BMI', record_date: '2026-03-10', status: 'Normal' },
          { id: 82, resident_id: 16, record_type: 'Adult BMI', record_date: '2026-03-11', status: 'Underweight' },
        ]];
      }
      return [[]];
    },
  };
  const { listNutritionRecords } = loadController('nutritionRecordController.js', {
    '../config/database': pool,
    '../services/logger': { error: () => {} },
  });
  const response = responseStub();

  await listNutritionRecords({ query: { resident_id: '15', pageSize: '50' } }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.total, 1);
  assert.deepEqual(response.body.data.items.map((row) => row.resident_id), [15]);
});
