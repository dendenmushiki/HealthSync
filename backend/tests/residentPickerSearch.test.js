const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;

test('resident list server search matches numeric IDs and accepts ID prefixes', async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('SELECT COUNT(*) AS total FROM residents')) return [[{ total: 0 }]];
      if (sql.includes('SELECT r.resident_id')) return [[]];
      throw new Error(`Unexpected SQL in resident picker test: ${sql}`);
    },
  };
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename?.endsWith('\\controllers\\residentController.js')) {
      if (request === '../config/database') return pool;
      if (request === '../services/logger') return { error: () => {} };
      if (request === '../services/residentSchemaService') return { ensureResidentSchema: async () => {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let listResidents;
  try {
    delete require.cache[require.resolve('../src/controllers/residentController')];
    ({ listResidents } = require('../src/controllers/residentController'));
  } finally {
    Module._load = originalLoad;
  }

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
  await listResidents({ query: { search: 'ID #42', page: '1', pageSize: '10' } }, response);
  delete require.cache[require.resolve('../src/controllers/residentController')];

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.total, 0);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query.sql, /CAST\(r\.resident_id AS CHAR\) LIKE \?/);
    assert.ok(query.values.includes('%42%'));
  }
});
