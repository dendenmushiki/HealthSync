const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;
const controllerPath = require.resolve('../src/controllers/offlineSecurityController');

function loadOfflineSecurityController(pool, auditCalls, bcrypt) {
  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === controllerPath) {
      if (request === '../config/database') return pool;
      if (request === 'bcrypt') return bcrypt;
      if (request === '../services/auditService') return { writeAudit: async (entry) => auditCalls.push(entry) };
      if (request === '../services/offlineSecurityService') {
        return {
          approveUserDevice: async () => true,
          checkDeviceAuthorization: async () => ({ ok: true }),
          ensureOfflineSecuritySchema: async () => {},
          listUserDevices: async () => [],
          revokeUserDevice: async () => true,
        };
      }
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

test('admin PIN reset route is authenticated, admin-only, and rate-limited', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'userRoutes.js'), 'utf8');
  assert.match(routes, /router\.post\('\/:id\/reset-offline-pin', authenticateToken, authorizeRole\(\['admin'\]\), resetOfflinePinLimiter, adminResetUserPin\)/);
});

test('admin PIN reset preserves existing PIN verifiers while requiring a fresh sign-in', async () => {
  const queries = [];
  const auditCalls = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT password FROM users')) return [[{ password: 'admin-hash' }]];
      if (sql.startsWith('SELECT user_id, username')) {
        return [[{
          user_id: 2,
          username: 'sample.user',
          must_change_password: 0,
          offline_pin_setup_required: 0,
          offline_pin_hash: 'existing-pin-hash',
        }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  const bcrypt = {
    compare: async (value, hash) => value === 'AdminPassword9!' && hash === 'admin-hash',
    hash: async (value) => `hash:${value}`,
  };
  const { adminResetUserPin } = loadOfflineSecurityController(
    { getConnection: async () => connection },
    auditCalls,
    bcrypt
  );
  const response = createResponse();

  await adminResetUserPin({
    params: { id: '2' },
    body: { current_password: 'AdminPassword9!' },
    user: { user_id: 1 },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  const userUpdate = queries.find(({ sql }) => sql.startsWith('UPDATE users SET offline_pin_setup_required'));
  assert.ok(userUpdate);
  assert.doesNotMatch(userUpdate.sql, /offline_pin_hash|offline_pin_version/);
  assert.ok(queries.some(({ sql }) => sql.includes("status = 'REVOKED'")));
  assert.equal(auditCalls[0].action, 'OFFLINE_PIN_RESET_REQUIRED');
});

test('PIN setup after an admin reset verifies the old credential before storing a new PIN', async () => {
  const queries = [];
  const auditCalls = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT password, offline_pin_hash')) {
        return [[{ password: 'account-password-hash', offline_pin_hash: 'old-pin-hash', offline_pin_version: 3 }]];
      }
      if (sql.startsWith('SELECT pin_hash, status')) {
        return [[{ pin_hash: 'old-device-pin-hash', status: 'ACTIVE' }]];
      }
      if (sql.startsWith('SELECT device_id, status')) {
        return [[{ device_id: 'device-1', status: 'ACTIVE' }, { device_id: 'device-2', status: 'ACTIVE' }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  const bcrypt = {
    compare: async (value, hash) => value === '000123' && hash === 'old-pin-hash',
    hash: async (value) => `hash:${value}`,
  };
  const { completePinSetup } = loadOfflineSecurityController(
    { getConnection: async () => connection, query: async () => [[]] },
    auditCalls,
    bcrypt
  );
  const response = createResponse();

  await completePinSetup({
    body: { pin: '000456', current_pin: '000123' },
    user: { user_id: 2, device_id: 'device-1', offline_pin_setup_required: true },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  const pinUpdate = queries.find(({ sql }) => sql.startsWith('UPDATE users SET offline_pin_setup_required = 0'));
  assert.ok(pinUpdate);
  assert.deepEqual(pinUpdate.params, ['hash:000456', 4, 2]);
  assert.ok(queries.some(({ sql }) => sql.startsWith('UPDATE offline_devices SET pin_version = 0')));
  assert.ok(queries.some(({ sql }) => sql.startsWith('UPDATE offline_devices SET pin_version = ?')));
  assert.equal(auditCalls[0].action, 'OFFLINE_PIN_RESET');
});
