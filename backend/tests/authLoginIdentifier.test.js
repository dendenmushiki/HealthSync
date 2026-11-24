const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const authControllerPath = path.join(__dirname, '..', 'src', 'controllers', 'authController.js');
const originalLoad = Module._load;

const createHarness = ({ usernameRows = [], emailRows = [] } = {}) => {
  const queries = [];
  const audits = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes('WHERE username = ? LIMIT 1')) return [usernameRows];
      if (sql.includes('WHERE LOWER(email) = LOWER(?) LIMIT 2')) return [emailRows];
      if (sql.startsWith('UPDATE users SET failed_login_attempts')) return [{ affectedRows: 1 }];
      if (sql.startsWith('SELECT failed_login_attempts')) return [[{ failed_login_attempts: 1, is_locked: 0 }]];
      if (sql.startsWith('INSERT INTO user_login_history')) return [{ insertId: 1 }];
      throw new Error(`Unexpected SQL in login identifier test: ${sql}`);
    },
  };

  Module._load = function load(request, parent, isMain) {
    if (parent?.filename === authControllerPath) {
      if (request === '../config/database') return pool;
      if (request === 'bcrypt') return { compare: async () => false };
      if (request === 'jsonwebtoken') return { sign: () => 'token', decode: () => ({ exp: 1 }) };
      if (request === 'dotenv') return { config: () => {} };
      if (request === '../services/auditService') return { logAudit: async (entry) => audits.push(entry) };
      if (request === './userController') return { ensureUserStatusColumn: async () => {}, normalizeRoleLabel: (role) => role };
      if (request === './adminSettingsController') return { ensureUserPhotoColumn: async () => {} };
      if (request === '../services/accountSecurityService') {
        return { ensureAccountSecuritySchema: async () => {}, readPreferences: async () => ({}) };
      }
      if (request === '../services/userManagementService') return { ensureUserManagementSchema: async () => {} };
      if (request === '../services/offlineSecurityService') {
        return {
          ensureOfflineSecuritySchema: async () => {},
          isDevicePinEnrolled: () => false,
          registerOrCheckDevice: async () => ({ ok: false }),
        };
      }
      if (request === '../services/passwordPolicy') return { validatePassword: () => ({ valid: true }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[authControllerPath];
  const { login } = require(authControllerPath);
  Module._load = originalLoad;
  delete require.cache[authControllerPath];

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
  return { login, queries, audits, response };
};

const makeRequest = (identifier, field = 'identifier') => ({
  body: { [field]: identifier, password: 'incorrect' },
  ip: '127.0.0.1',
  get: () => 'login-identifier-test',
});

const matchingUser = {
  user_id: 7,
  username: 'health.worker',
  email: 'worker@example.org',
  password: 'stored-hash',
  is_active: 1,
  is_locked: 0,
  must_change_password: 0,
};

test('looks up login identifiers by email case-insensitively after username lookup', async () => {
  const harness = createHarness({ emailRows: [matchingUser] });

  await harness.login(makeRequest(' WORKER@EXAMPLE.ORG '), harness.response);

  assert.equal(harness.response.statusCode, 401);
  assert.match(harness.queries[0].sql, /WHERE username = \? LIMIT 1$/);
  assert.deepEqual(harness.queries[0].values, ['WORKER@EXAMPLE.ORG']);
  assert.match(harness.queries[1].sql, /WHERE LOWER\(email\) = LOWER\(\?\) LIMIT 2$/);
  assert.deepEqual(harness.queries[1].values, ['WORKER@EXAMPLE.ORG']);
});

test('keeps username lookup first and accepts the legacy username request property', async () => {
  const harness = createHarness({ usernameRows: [matchingUser] });

  await harness.login(makeRequest('health.worker', 'username'), harness.response);

  assert.equal(harness.response.statusCode, 401);
  assert.equal(harness.queries.length, 4);
  assert.match(harness.queries[0].sql, /WHERE username = \? LIMIT 1$/);
  assert.deepEqual(harness.queries[0].values, ['health.worker']);
});

test('rejects ambiguous email addresses rather than choosing an arbitrary account', async () => {
  const harness = createHarness({ emailRows: [matchingUser, { ...matchingUser, user_id: 8 }] });

  await harness.login(makeRequest('worker@example.org'), harness.response);

  assert.equal(harness.response.statusCode, 401);
  assert.equal(harness.queries.length, 3);
  assert.equal(harness.audits[0].action, 'LOGIN_FAILED');
});
