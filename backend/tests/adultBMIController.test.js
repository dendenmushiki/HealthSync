const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const dashboardSummaryCache = require('../src/services/dashboardSummaryCache');

const originalLoad = Module._load;

test('creates an Adult BMI record and audit entry through the idempotency transaction', async () => {
  dashboardSummaryCache.set('nutrition-cache-test', { nutrition: {} });
  const queries = [];
  const auditEntries = [];
  const connection = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('SELECT resident_id, birthdate FROM residents')) {
        return [[{ resident_id: 15, birthdate: '1990-01-01' }]];
      }
      if (sql.includes('INSERT INTO adult_bmi_records')) return [{ insertId: 91 }];
      if (sql.includes('SELECT * FROM adult_bmi_records WHERE bmi_id = ?')) {
        return [[{
          bmi_id: 91,
          resident_id: 15,
          bmi: 22.77,
          bmi_category: 'Normal',
          recorded_by: 7,
        }]];
      }
      throw new Error(`Unexpected SQL in Adult BMI controller test: ${sql}`);
    },
  };
  const pool = {
    query() {
      throw new Error('Atomic Adult BMI persistence must not use the shared pool.');
    },
  };
  Module._load = function load(request, parent, isMain) {
    if (request === '../config/database' && parent?.filename?.endsWith('\\controllers\\adultBMIController.js')) return pool;
    if (request === '../services/auditService' && parent?.filename?.endsWith('\\controllers\\adultBMIController.js')) {
      return { writeAudit: async (entry) => auditEntries.push(entry) };
    }
    if (request === '../services/nutrition' && parent?.filename?.endsWith('\\controllers\\adultBMIController.js')) {
      return {
        ageService: { getAgeYears: () => 25 },
        bmiService: {
          validateBMIInput: () => ({ valid: true }),
          calculateBMI: () => 22.77,
          classifyAdultBMI: () => 'Normal',
        },
      };
    }
    if (request === '../services/logger' && parent?.filename?.endsWith('\\controllers\\adultBMIController.js')) {
      return { error: () => {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('../src/controllers/adultBMIController')];
  const { createAdultBMI } = require('../src/controllers/adultBMIController');
  Module._load = originalLoad;

  const res = {
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
  await createAdultBMI({
    idempotencyConnection: connection,
    user: { user_id: 7 },
    body: { resident_id: 15, height_cm: 165, weight_kg: 62, date_recorded: '2026-11-16' },
  }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.recorded_by, 7);
  assert.equal(queries.length, 3);
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].connection, connection);
  assert.equal(dashboardSummaryCache.get('nutrition-cache-test'), null);
});

test('enables atomic idempotency specifically on Adult BMI creation', () => {
  const registrations = [];
  const idempotencyOptions = [];
  const router = {
    get: (...args) => registrations.push(['get', ...args]),
    post: (...args) => registrations.push(['post', ...args]),
    put: (...args) => registrations.push(['put', ...args]),
    delete: (...args) => registrations.push(['delete', ...args]),
  };
  const authMiddleware = () => {};
  const idempotencyMiddleware = () => {};
  Module._load = function load(request, parent, isMain) {
    if (request === 'express' && parent?.filename?.endsWith('\\routes\\adultBMIRoutes.js')) {
      return { Router: () => router };
    }
    if (request === '../middleware/authenticate' && parent?.filename?.endsWith('\\routes\\adultBMIRoutes.js')) {
      return authMiddleware;
    }
    if (request === '../middleware/authorize' && parent?.filename?.endsWith('\\routes\\adultBMIRoutes.js')) {
      return () => authMiddleware;
    }
    if (request === '../middleware/idempotency' && parent?.filename?.endsWith('\\routes\\adultBMIRoutes.js')) {
      return (...args) => {
        idempotencyOptions.push(args);
        return idempotencyMiddleware;
      };
    }
    if (request === '../controllers/adultBMIController' && parent?.filename?.endsWith('\\routes\\adultBMIRoutes.js')) {
      return Object.fromEntries([
        'listAdultBMI', 'getAdultBMI', 'createAdultBMI', 'updateAdultBMI',
        'deleteAdultBMI', 'previewAdultBMI', 'getPreviousAdultBMI',
      ].map((name) => [name, () => {}]));
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('../src/routes/adultBMIRoutes')];
  require('../src/routes/adultBMIRoutes');
  Module._load = originalLoad;

  const createRoute = registrations.find(([method, path]) => method === 'post' && path === '/');
  assert.deepEqual(idempotencyOptions.filter(([, , options]) => options?.atomic), [
    ['adult_bmi', 'adult_bmi_records', { atomic: true }],
  ]);
  assert.ok(createRoute.includes(idempotencyMiddleware));
});
