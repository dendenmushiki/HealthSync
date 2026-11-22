const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
const controllerPath = require.resolve('../src/controllers/dashboardController');

test('returns current recent activity records from the database without HTTP caching', async () => {
  const activityRow = {
    record_id: 24,
    resident_id: 12,
    first_name: 'Rosa',
    last_name: 'Mendoza',
    record_type: 'clinical',
    record_label: 'Clinical record',
    summary: 'Follow-up',
    record_date: '2026-11-22',
    recorded_by_name: 'Health Worker',
    activity_at: '2026-11-22T08:30:00.000Z',
  };
  let queryText = '';
  const pool = {
    async query(sql) {
      queryText = sql;
      return [[activityRow]];
    },
  };

  Module._load = function load(request, parent, isMain) {
    if (request === '../config/database' && parent?.filename?.endsWith('\\controllers\\dashboardController.js')) return pool;
    if (request === '../services/logger' && parent?.filename?.endsWith('\\controllers\\dashboardController.js')) {
      return { error: () => {} };
    }
    if (request === '../services/manilaDateService' && parent?.filename?.endsWith('\\controllers\\dashboardController.js')) {
      return { getManilaToday: () => '2026-11-22' };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[controllerPath];
  let getRecentActivity;
  try {
    ({ getRecentActivity } = require(controllerPath));
  } finally {
    Module._load = originalLoad;
  }

  const response = {
    headers: {},
    statusCode: 200,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await getRecentActivity({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(response.body.data, [{
    id: 'clinical-24',
    residentId: 12,
    residentName: 'Rosa Mendoza',
    type: 'clinical',
    label: 'Clinical record',
    summary: 'Follow-up',
    recordedBy: 'Health Worker',
    date: '2026-11-22',
    createdAt: '2026-11-22T08:30:00.000Z',
  }]);

  for (const table of [
    'health_records',
    'patient_clinical_records',
    'child_health_records',
    'child_records',
    'operation_timbang',
    'maternal_records',
    'immunization_records',
    'adolescent_bmi_records',
    'adult_bmi_records',
  ]) {
    assert.match(queryText, new RegExp(`FROM ${table}\\b`));
  }
  assert.match(queryText, /ORDER BY activity_at DESC/);
});
